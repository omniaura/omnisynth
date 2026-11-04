use crate::engine::{Controller, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

pub fn start(engine: Engine) -> Result<(cpal::Stream, String), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("No output device. Select one or use --offline-audio for explicit simulation.")?;
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    // Engine must use the device's actual sample rate; callers create it using rate().
    let channels = config.channels as usize;
    let label = format!("CPAL / {} Hz / {} channels", config.sample_rate, channels);
    let error = |error| eprintln!("Audio output stopped: {error}");
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, &config, engine, channels, error),
        cpal::SampleFormat::I16 => build::<i16>(&device, &config, engine, channels, error),
        cpal::SampleFormat::U16 => build::<u16>(&device, &config, engine, channels, error),
        _ => return Err(format!("Unsupported output sample format: {format}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, label))
}

fn build<T: cpal::SizedSample + cpal::FromSample<f32>>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut engine: Engine,
    channels: usize,
    error: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    device.build_output_stream(
        config,
        move |data: &mut [T], _| {
            engine.commands();
            let mut sum = 0.;
            let mut peak: f32 = 0.;
            let mut count = 0;
            for frame in data.chunks_mut(channels) {
                let sample = engine.sample();
                sum += (sample as f64).powi(2);
                peak = peak.max(sample.abs());
                count += 1;
                for channel in frame {
                    *channel = T::from_sample(sample);
                }
            }
            engine.publish(sum, peak, count);
        },
        error,
        None,
    )
}

pub fn rate() -> Result<u32, String> {
    cpal::default_host()
        .default_output_device()
        .ok_or("No output device")?
        .default_output_config()
        .map(|c| c.sample_rate())
        .map_err(|e| e.to_string())
}

pub fn render_wav(
    path: &std::path::Path,
    control: &Controller,
    engine: &mut Engine,
    seconds: u32,
) -> Result<(), String> {
    control.send(crate::engine::Change::Transport(true))?;
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 48000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    let mut buffer = [0.; 480];
    for _ in 0..seconds * 100 {
        engine.render(&mut buffer);
        for sample in buffer {
            writer
                .write_sample((sample * i16::MAX as f32) as i16)
                .map_err(|e| e.to_string())?;
        }
    }
    writer.finalize().map_err(|e| e.to_string())
}
