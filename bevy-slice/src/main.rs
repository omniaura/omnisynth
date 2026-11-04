mod audio;
mod bridge;
mod engine;

use bevy::{
    app::AppExit,
    prelude::*,
    render::view::screenshot::{Screenshot, save_to_disk},
};
use engine::{Change, Controller, Engine, Waveform, visual_energy};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Resource)]
struct Studio {
    control: Controller,
    audio_label: String,
    stopping: Arc<AtomicBool>,
}
#[derive(Resource)]
struct Capture {
    path: Option<PathBuf>,
    exit_after: Option<f32>,
    captured: bool,
}
struct OfflineAudio {
    engine: Engine,
    remainder: f64,
}
#[derive(Component)]
struct Ribbon {
    band: usize,
    index: usize,
}
#[derive(Component)]
struct StepCell(usize);
#[derive(Component)]
struct Status;

fn text(commands: &mut Commands, value: &str, x: f32, y: f32, size: f32, color: Color) {
    commands.spawn((
        Text2d::new(value),
        TextFont {
            font_size: bevy::text::FontSize::Px(size),
            ..default()
        },
        TextColor(color),
        Transform::from_xyz(x, y, 5.),
    ));
}
fn rect(commands: &mut Commands, color: Color, size: Vec2, position: Vec3) {
    commands.spawn((
        Sprite::from_color(color, size),
        Transform::from_translation(position),
    ));
}
fn setup(mut commands: Commands) {
    commands.spawn(Camera2d);
    rect(
        &mut commands,
        Color::srgb(0.022, 0.035, 0.065),
        Vec2::new(1040., 630.),
        Vec3::new(0., 0., -2.),
    );
    text(
        &mut commands,
        "O M N I S Y N T H   /   N A T I V E",
        0.,
        265.,
        24.,
        Color::srgb(0.75, 0.86, 0.95),
    );
    text(
        &mut commands,
        "BEVY VERTICAL SLICE",
        0.,
        227.,
        13.,
        Color::srgb(0.3, 0.55, 0.68),
    );
    for band in 0..3 {
        for index in 0..100 {
            commands.spawn((
                Sprite::from_color(Color::WHITE, Vec2::new(5., 5.)),
                Transform::default(),
                Ribbon { band, index },
            ));
        }
    }
    rect(
        &mut commands,
        Color::srgb(0.035, 0.055, 0.085),
        Vec2::new(920., 85.),
        Vec3::new(0., -185., -1.),
    );
    for step in 0..16 {
        commands.spawn((
            Sprite::from_color(Color::srgb(0.1, 0.16, 0.21), Vec2::new(43., 43.)),
            Transform::from_xyz(-420. + step as f32 * 56., -185., 1.),
            StepCell(step),
        ));
        text(
            &mut commands,
            &format!("{:02}", step + 1),
            -420. + step as f32 * 56.,
            -227.,
            11.,
            Color::srgb(0.3, 0.5, 0.6),
        );
    }
    commands.spawn((
        Text2d::new("Connecting audio…"),
        TextFont {
            font_size: bevy::text::FontSize::Px(15.),
            ..default()
        },
        TextColor(Color::srgb(0.5, 0.8, 0.85)),
        Transform::from_xyz(0., -105., 5.),
        Status,
    ));
    text(
        &mut commands,
        "SPACE  play / stop     ↑ ↓  tempo     W  waveform     R  reset pattern     CLICK  toggle step",
        0.,
        -280.,
        13.,
        Color::srgb(0.5, 0.62, 0.7),
    );
}

#[allow(clippy::too_many_arguments)]
fn update(
    studio: Res<Studio>,
    time: Res<Time>,
    keyboard: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    window: Single<&Window>,
    mut ribbon: Query<(&Ribbon, &mut Transform, &mut Sprite), Without<StepCell>>,
    mut steps: Query<(&StepCell, &mut Sprite), Without<Ribbon>>,
    mut status: Query<&mut Text2d, With<Status>>,
    mut offline: Option<NonSendMut<OfflineAudio>>,
    mut capture: ResMut<Capture>,
    mut commands: Commands,
    mut exit: MessageWriter<AppExit>,
) {
    if let Some(offline) = offline.as_mut() {
        offline.remainder += time.delta_secs_f64().min(0.1) * 48000.;
        let mut buffer = [0.; 512];
        while offline.remainder >= 1. {
            let n = (offline.remainder as usize).min(buffer.len());
            offline.engine.render(&mut buffer[..n]);
            offline.remainder -= n as f64;
        }
    }
    let state = studio.control.meter.snapshot();
    if keyboard.just_pressed(KeyCode::Space) {
        let _ = studio.control.send(Change::Transport(!state.playing));
    }
    if keyboard.just_pressed(KeyCode::ArrowUp) || keyboard.just_pressed(KeyCode::ArrowDown) {
        let mut p = state.pattern.clone();
        p.bpm = (p.bpm
            + if keyboard.just_pressed(KeyCode::ArrowUp) {
                5.
            } else {
                -5.
            })
        .clamp(40., 240.);
        let _ = studio.control.send(Change::Pattern(p));
    }
    if keyboard.just_pressed(KeyCode::KeyW) {
        let mut p = state.pattern.clone();
        p.waveform = if p.waveform == Waveform::Sine {
            Waveform::Triangle
        } else {
            Waveform::Sine
        };
        let _ = studio.control.send(Change::Pattern(p));
    }
    if keyboard.just_pressed(KeyCode::KeyR) {
        let _ = studio
            .control
            .send(Change::Pattern(engine::Pattern::default()));
    }
    if mouse.just_pressed(MouseButton::Left)
        && let Some(cursor) = window.cursor_position()
    {
        let x = (cursor.x / window.width() - 0.5) * 1100.;
        let y = (0.5 - cursor.y / window.height()) * 700.;
        if (-208. ..=-162.).contains(&y) && (-442. ..=442.).contains(&x) {
            let index = ((x + 448.) / 56.).floor() as usize;
            if index < 16 {
                let mut p = state.pattern.clone();
                p.notes[index] = if p.notes[index].is_some() {
                    None
                } else {
                    Some(48)
                };
                let _ = studio.control.send(Change::Pattern(p));
            }
        }
    }
    let energy = visual_energy(state.rms);
    let t = time.elapsed_secs();
    for (r, mut transform, mut sprite) in &mut ribbon {
        let u = r.index as f32 / 99.;
        let phase = u * std::f32::consts::TAU * 2. + t * 0.5 + r.band as f32 * 1.4;
        transform.translation = Vec3::new(
            (u - 0.5) * 830.,
            50. + (phase.sin() * 65. + (phase * 0.57).cos() * 35.) * energy
                + (r.band as f32 - 1.) * 12.,
            r.band as f32,
        );
        sprite.custom_size = Some(Vec2::new(5., 5. + energy * 17.));
        sprite.color = match r.band {
            0 => Color::srgb(0.05, 0.78, 0.78),
            1 => Color::srgb(0.4, 0.4, 0.95),
            _ => Color::srgb(0.8, 0.25, 0.65),
        }
        .with_alpha(0.3 + energy * 0.65);
    }
    for (cell, mut sprite) in &mut steps {
        let active = state.pattern.notes[cell.0].is_some();
        sprite.color = if state.playing && state.step as usize == cell.0 {
            Color::srgb(0.2, 0.95, 0.8)
        } else if active {
            Color::srgb(0.13, 0.4, 0.48)
        } else {
            Color::srgb(0.055, 0.085, 0.12)
        };
    }
    for mut text in &mut status {
        text.0 = format!(
            "{}   ·   {:.0} BPM   ·   {:?}   ·   RMS {:.3}   ·   {}",
            if state.playing { "PLAYING" } else { "READY" },
            state.pattern.bpm,
            state.pattern.waveform,
            state.rms,
            studio.audio_label
        );
    }
    if !capture.captured && time.elapsed_secs() > 3. {
        if let Some(path) = &capture.path {
            commands
                .spawn(Screenshot::primary_window())
                .observe(save_to_disk(path.clone()));
        }
        capture.captured = true;
    }
    if studio.stopping.load(Ordering::Relaxed)
        || capture
            .exit_after
            .is_some_and(|limit| time.elapsed_secs() > limit)
    {
        exit.write(AppExit::Success);
    }
}

fn run() -> Result<(), String> {
    let mut data_dir = bridge::data_dir();
    let mut offline = false;
    let mut screenshot = None;
    let mut exit_after = None;
    let mut wav = None;
    let mut seconds = 8;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--data-dir" => data_dir = PathBuf::from(args.next().ok_or("--data-dir needs a path")?),
            "--offline-audio" => offline = true,
            "--screenshot" => {
                screenshot = Some(PathBuf::from(
                    args.next().ok_or("--screenshot needs a path")?,
                ))
            }
            "--exit-after" => {
                exit_after = Some(
                    args.next()
                        .ok_or("--exit-after needs seconds")?
                        .parse::<f32>()
                        .map_err(|e| e.to_string())?,
                )
            }
            "--render-wav" => {
                wav = Some(PathBuf::from(
                    args.next().ok_or("--render-wav needs a path")?,
                ))
            }
            "--seconds" => {
                seconds = args
                    .next()
                    .ok_or("--seconds needs a value")?
                    .parse::<u32>()
                    .map_err(|e| e.to_string())?
            }
            "--help" => {
                println!(
                    "OmniSynth Bevy Slice\n  SPACE: transport; arrows: tempo; W: waveform; click: step\n  --data-dir PATH --screenshot FILE --exit-after SECONDS\n  --render-wav FILE --seconds 1..60\n  --offline-audio: explicit simulation; no device output"
                );
                return Ok(());
            }
            _ => return Err(format!("Unknown argument: {arg}")),
        }
    }
    if !(1..=60).contains(&seconds) {
        return Err("--seconds must be 1..60".into());
    }
    if exit_after.is_some_and(|v| !v.is_finite() || v < 1.) {
        return Err("--exit-after must be finite and >=1".into());
    }
    if let Some(path) = wav {
        let (mut engine, control) = Engine::new(48000);
        audio::render_wav(&path, &control, &mut engine, seconds)?;
        println!(
            "Rendered {}: {}",
            path.display(),
            serde_json::to_string(&control.meter.snapshot()).unwrap()
        );
        return Ok(());
    }
    let sample_rate = if offline { 48000 } else { audio::rate()? };
    let (engine, control) = Engine::new(sample_rate);
    let mut app = App::new();
    let live;
    let label;
    if offline {
        app.insert_non_send(OfflineAudio {
            engine,
            remainder: 0.,
        });
        live = None;
        label = "OFFLINE SIMULATION / no device output".to_string();
    } else {
        let (stream, description) = audio::start(engine)?;
        live = Some(stream);
        label = description;
    }
    let bridge = bridge::Bridge::start(control.clone(), &data_dir)?;
    println!("Native slice ready; discovery: {}", bridge.path.display());
    let stopping = Arc::new(AtomicBool::new(false));
    let stop = stopping.clone();
    ctrlc::set_handler(move || stop.store(true, Ordering::Relaxed)).map_err(|e| e.to_string())?;
    app.insert_resource(Studio {
        control,
        audio_label: label,
        stopping,
    })
    .insert_resource(Capture {
        path: screenshot,
        exit_after,
        captured: false,
    })
    .insert_resource(ClearColor(Color::srgb(0.008, 0.012, 0.025)))
    .add_plugins(DefaultPlugins.set(WindowPlugin {
        primary_window: Some(Window {
            title: "OmniSynth Bevy Slice".into(),
            resolution: (1100, 700).into(),
            resizable: false,
            ..default()
        }),
        ..default()
    }))
    .add_systems(Startup, setup)
    .add_systems(Update, update)
    .run();
    drop(bridge);
    drop(live);
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("OmniSynth Bevy Slice: {error}");
        std::process::exit(1);
    }
}
