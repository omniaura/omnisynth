use serde::{Deserialize, Serialize};
use std::f32::consts::TAU;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
    mpsc::{Receiver, SyncSender, sync_channel},
};

pub const STEPS: usize = 16;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Waveform {
    #[default]
    Sine,
    Triangle,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pattern {
    pub notes: [Option<u8>; STEPS],
    pub bpm: f32,
    pub gain: f32,
    pub waveform: Waveform,
}
impl Default for Pattern {
    fn default() -> Self {
        Self {
            notes: [
                Some(48),
                None,
                Some(55),
                None,
                Some(60),
                None,
                Some(55),
                None,
                Some(51),
                None,
                Some(58),
                None,
                Some(63),
                Some(58),
                Some(55),
                None,
            ],
            bpm: 120.,
            gain: 0.18,
            waveform: Waveform::Sine,
        }
    }
}
impl Pattern {
    pub fn validate(&self) -> Result<(), String> {
        if !self.bpm.is_finite() || !(40.0..=240.0).contains(&self.bpm) {
            return Err("bpm must be between 40 and 240".into());
        }
        if !self.gain.is_finite() || !(0.0..=0.25).contains(&self.gain) {
            return Err("gain must be between 0 and 0.25".into());
        }
        if self.notes.iter().flatten().any(|n| !(24..=96).contains(n)) {
            return Err("notes must be MIDI 24..96 or null (rest)".into());
        }
        Ok(())
    }
}

pub enum Change {
    Pattern(Pattern),
    Transport(bool),
    Edit(Edit),
}
pub enum Edit {
    Tempo(i8),
    Waveform,
    ToggleStep(usize),
    Reset,
}
pub struct Command {
    pub revision: u64,
    pub change: Change,
}

pub struct Meter {
    pub audio_errors: AtomicU64,
    latest: Mutex<Snapshot>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub frames: u64,
    pub applied_revision: u64,
    pub audio_errors: u64,
    pub playing: bool,
    pub step: u8,
    pub rms: f32,
    pub peak: f32,
    pub pattern: Pattern,
}
impl Meter {
    fn new(p: &Pattern) -> Self {
        Self {
            audio_errors: AtomicU64::new(0),
            latest: Mutex::new(Snapshot {
                frames: 0,
                applied_revision: 0,
                audio_errors: 0,
                playing: false,
                step: 0,
                rms: 0.,
                peak: 0.,
                pattern: p.clone(),
            }),
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        let mut snapshot = self
            .latest
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        snapshot.audio_errors = self.audio_errors.load(Ordering::Relaxed);
        snapshot
    }
}

#[derive(Clone)]
pub struct Controller {
    tx: SyncSender<Command>,
    pub meter: Arc<Meter>,
    next: Arc<Mutex<u64>>,
}
impl Controller {
    pub fn send(&self, change: Change) -> Result<u64, String> {
        if let Change::Pattern(p) = &change {
            p.validate()?;
        }
        if let Change::Edit(Edit::ToggleStep(index)) = &change
            && *index >= STEPS
        {
            return Err("step must be 0..15".into());
        }
        let mut next = self
            .next
            .lock()
            .map_err(|_| "command controller unavailable".to_string())?;
        let revision = *next;
        self.tx
            .try_send(Command { revision, change })
            .map_err(|_| "audio command queue unavailable or full".to_string())?;
        *next += 1;
        Ok(revision)
    }
}

pub struct Engine {
    rx: Receiver<Command>,
    meter: Arc<Meter>,
    pub pattern: Pattern,
    sample_rate: f64,
    playing: bool,
    step: usize,
    step_phase: f64,
    oscillator_phase: f32,
    frequency: f32,
    envelope: f32,
    age: u64,
    frames: u64,
    revision: u64,
    trigger: bool,
    decay: f32,
}
impl Engine {
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate as u32
    }
    pub fn meter(&self) -> Arc<Meter> {
        self.meter.clone()
    }
    pub fn new(sample_rate: u32) -> (Self, Controller) {
        assert!(sample_rate > 0);
        let pattern = Pattern::default();
        let meter = Arc::new(Meter::new(&pattern));
        let (tx, rx) = sync_channel(64);
        let controller = Controller {
            tx,
            meter: meter.clone(),
            next: Arc::new(Mutex::new(1)),
        };
        (
            Self {
                rx,
                meter,
                pattern,
                sample_rate: sample_rate as f64,
                playing: false,
                step: 0,
                step_phase: 0.,
                oscillator_phase: 0.,
                frequency: 220.,
                envelope: 0.,
                age: 0,
                frames: 0,
                revision: 0,
                trigger: false,
                decay: (-1. / (0.18 * sample_rate as f32)).exp(),
            },
            controller,
        )
    }
    pub fn commands(&mut self) {
        // Fixed queue capacity bounds callback work. No waiting, allocation or I/O.
        for _ in 0..64 {
            let Ok(command) = self.rx.try_recv() else {
                break;
            };
            match command.change {
                Change::Pattern(p) => self.pattern = p,
                Change::Edit(edit) => match edit {
                    Edit::Tempo(delta) => {
                        self.pattern.bpm = (self.pattern.bpm + delta as f32).clamp(40., 240.)
                    }
                    Edit::Waveform => {
                        self.pattern.waveform = if self.pattern.waveform == Waveform::Sine {
                            Waveform::Triangle
                        } else {
                            Waveform::Sine
                        }
                    }
                    Edit::ToggleStep(index) => {
                        if index < STEPS {
                            self.pattern.notes[index] = if self.pattern.notes[index].is_some() {
                                None
                            } else {
                                Some(48)
                            };
                        }
                    }
                    Edit::Reset => self.pattern = Pattern::default(),
                },
                Change::Transport(play) => {
                    self.playing = play;
                    self.step = 0;
                    self.step_phase = 0.;
                    self.envelope = 0.;
                    self.trigger = play;
                }
            }
            self.revision = command.revision;
        }
    }
    pub fn sample(&mut self) -> f32 {
        self.frames += 1;
        if !self.playing {
            return 0.;
        }
        if self.trigger {
            if let Some(note) = self.pattern.notes[self.step] {
                self.frequency = 440. * 2_f32.powf((note as f32 - 69.) / 12.);
                self.age = 0;
                self.envelope = 1.;
                self.oscillator_phase = 0.;
            }
            self.trigger = false;
        }
        let attack = (self.age as f32 / (0.005 * self.sample_rate as f32)).min(1.);
        let wave = match self.pattern.waveform {
            Waveform::Sine => (self.oscillator_phase * TAU).sin(),
            Waveform::Triangle => 1. - 4. * (self.oscillator_phase - 0.5).abs(),
        };
        let sample = wave * attack * self.envelope * self.pattern.gain;
        self.oscillator_phase =
            (self.oscillator_phase + self.frequency / self.sample_rate as f32).fract();
        self.age += 1;
        self.envelope *= self.decay;
        self.step_phase += self.pattern.bpm as f64 * 4.;
        if self.step_phase >= 60. * self.sample_rate {
            self.step_phase -= 60. * self.sample_rate;
            self.step = (self.step + 1) % STEPS;
            self.trigger = true;
        }
        sample
    }
    pub fn publish(&self, square_sum: f64, peak: f32, count: usize) {
        // Never wait for a reader. A missed telemetry publication is retried on
        // the next callback; acknowledgements cannot outrun their pattern data.
        if let Ok(mut latest) = self.meter.latest.try_lock() {
            *latest = Snapshot {
                frames: self.frames,
                applied_revision: self.revision,
                audio_errors: 0,
                playing: self.playing,
                step: self.step as u8,
                rms: (square_sum / count.max(1) as f64).sqrt() as f32,
                peak,
                pattern: self.pattern.clone(),
            };
        }
    }
    pub fn render(&mut self, output: &mut [f32]) {
        self.commands();
        let mut sum = 0.;
        let mut peak: f32 = 0.;
        for sample in output.iter_mut() {
            *sample = self.sample();
            sum += (*sample as f64).powi(2);
            peak = peak.max(sample.abs());
        }
        self.publish(sum, peak, output.len());
    }
}

pub fn visual_energy(rms: f32) -> f32 {
    (rms * 8.).clamp(0., 1.)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edits_compose_and_snapshot_publication_never_waits_for_a_reader() {
        let (mut engine, control) = Engine::new(48000);
        control.send(Change::Edit(Edit::Tempo(5))).unwrap();
        control.send(Change::Edit(Edit::Waveform)).unwrap();
        let revision = control.send(Change::Edit(Edit::ToggleStep(1))).unwrap();
        let guard = control.meter.latest.lock().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            engine.render(&mut [0.; 128]);
            tx.send(engine).unwrap();
        });
        let mut engine = rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("audio callback waited for a telemetry reader");
        drop(guard);
        worker.join().unwrap();
        assert_eq!(control.meter.snapshot().applied_revision, 0);
        engine.render(&mut [0.; 128]);
        let state = control.meter.snapshot();
        assert_eq!(state.applied_revision, revision);
        assert_eq!(state.pattern.bpm, 125.);
        assert_eq!(state.pattern.waveform, Waveform::Triangle);
        assert_eq!(state.pattern.notes[1], Some(48));
    }
    #[test]
    fn block_size_does_not_change_music_and_queue_is_bounded() {
        let (mut a, ca) = Engine::new(48000);
        let (mut b, cb) = Engine::new(48000);
        ca.send(Change::Transport(true)).unwrap();
        cb.send(Change::Transport(true)).unwrap();
        let mut flat = vec![0.; 96000];
        a.render(&mut flat);
        let mut chunked = vec![0.; 96000];
        for chunk in chunked.chunks_mut(257) {
            b.render(chunk);
        }
        assert_eq!(flat, chunked);
        assert_eq!(cb.meter.snapshot().step, 0);
        for _ in 0..64 {
            cb.send(Change::Transport(false)).unwrap();
        }
        assert!(cb.send(Change::Transport(true)).is_err());
    }
    #[test]
    fn sample_clock_wraps_exactly_and_stop_is_silent() {
        let (mut engine, control) = Engine::new(48000);
        control.send(Change::Transport(true)).unwrap();
        let mut audio = vec![0.; 24000];
        engine.render(&mut audio);
        assert_eq!(control.meter.snapshot().step, 4);
        assert!(audio.iter().any(|x| x.abs() > 0.01));
        assert!(audio.iter().all(|x| x.is_finite() && x.abs() <= 0.25));
        let revision = control.send(Change::Transport(false)).unwrap();
        engine.render(&mut audio);
        assert!(audio.iter().all(|x| *x == 0.));
        assert_eq!(control.meter.snapshot().applied_revision, revision);
    }
    #[test]
    fn rest_pattern_and_zero_gain_produce_no_energy() {
        for pattern in [
            Pattern {
                notes: [None; 16],
                ..Pattern::default()
            },
            Pattern {
                gain: 0.,
                ..Pattern::default()
            },
        ] {
            let (mut engine, control) = Engine::new(48000);
            control.send(Change::Pattern(pattern)).unwrap();
            control.send(Change::Transport(true)).unwrap();
            let mut audio = vec![0.; 48000];
            engine.render(&mut audio);
            assert!(audio.iter().all(|x| *x == 0.));
            assert_eq!(visual_energy(control.meter.snapshot().rms), 0.);
        }
    }
    #[test]
    fn pitch_and_visuals_come_from_generated_samples() {
        let (mut engine, control) = Engine::new(48000);
        control
            .send(Change::Pattern(Pattern {
                notes: [Some(69); 16],
                bpm: 40.,
                ..Pattern::default()
            }))
            .unwrap();
        control.send(Change::Transport(true)).unwrap();
        let mut audio = vec![0.; 4800];
        engine.render(&mut audio);
        let rising = audio.windows(2).filter(|w| w[0] <= 0. && w[1] > 0.).count();
        assert!((43..=45).contains(&rising));
        assert!(visual_energy(control.meter.snapshot().rms) > 0.1);
        assert!(
            Pattern {
                bpm: f32::NAN,
                ..Pattern::default()
            }
            .validate()
            .is_err()
        );
        assert!(
            Pattern {
                notes: [Some(127); 16],
                ..Pattern::default()
            }
            .validate()
            .is_err()
        );
    }
}
