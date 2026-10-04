// Strudel audio engine wrapper
// Uses @strudel/web for custom UI integration

let isInitialized = false;
let isPlaying = false;
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;

// Store Strudel globals after init
let strudelGlobals: Record<string, unknown> = {};

export async function initStrudel(): Promise<void> {
  if (isInitialized) return;

  // Dynamic import of @strudel/web
  const strudelWeb = await import("@strudel/web");

  // Initialize Strudel - this sets up global functions
  await strudelWeb.initStrudel();

  // Capture global Strudel functions
  const win = window as unknown as Record<string, unknown>;
  strudelGlobals = {
    note: win.note,
    sound: win.sound,
    s: win.s,
    n: win.n,
    stack: win.stack,
    cat: win.cat,
    seq: win.seq,
    polymeter: win.polymeter,
    rev: win.rev,
    jux: win.jux,
    add: win.add,
    sub: win.sub,
    mul: win.mul,
    div: win.div,
    gain: win.gain,
    pan: win.pan,
    speed: win.speed,
    room: win.room,
    delay: win.delay,
    lpf: win.lpf,
    hpf: win.hpf,
    vowel: win.vowel,
    slow: win.slow,
    fast: win.fast,
    every: win.every,
    sometimes: win.sometimes,
    rarely: win.rarely,
    almostNever: win.almostNever,
    almostAlways: win.almostAlways,
    degradeBy: win.degradeBy,
    euclid: win.euclid,
    scale: win.scale,
    hush: win.hush,
    setcps: win.setcps,
    silence: win.silence,
    sine: win.sine,
    cosine: win.cosine,
    saw: win.saw,
    tri: win.tri,
    square: win.square,
    rand: win.rand,
    irand: win.irand,
    perlin: win.perlin,
    // Pattern methods
    Pattern: win.Pattern,
    pure: win.pure,
    reify: win.reify,
    mini: win.mini,
  };

  // Create audio context and analyser for Hydra integration
  audioContext = new AudioContext();
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 256;
  analyserNode.smoothingTimeConstant = 0.8;

  // Connect to destination through analyser
  const destination = audioContext.destination;
  analyserNode.connect(destination);

  isInitialized = true;
}

export function getAudioContext(): AudioContext | null {
  return audioContext;
}

export function getAnalyserNode(): AnalyserNode | null {
  return analyserNode;
}

export function getStrudelGlobals(): Record<string, unknown> {
  return strudelGlobals;
}

export async function evaluateStrudelCode(code: string): Promise<void> {
  if (!isInitialized) {
    await initStrudel();
  }

  try {
    // Create function with Strudel globals in scope
    const globalNames = Object.keys(strudelGlobals);
    const globalValues = Object.values(strudelGlobals);

    const evalFn = new Function(...globalNames, code);
    const result = evalFn(...globalValues);

    // If the result has a .play() method, call it
    if (result && typeof result.play === "function") {
      result.play();
      isPlaying = true;
    }
  } catch (err) {
    console.error("Strudel eval error:", err);
    throw err;
  }
}

export function hush(): void {
  const win = window as unknown as Record<string, unknown>;
  if (typeof win.hush === "function") {
    (win.hush as () => void)();
  }
  isPlaying = false;
}

export function play(): void {
  // Resume audio context if suspended
  if (audioContext?.state === "suspended") {
    audioContext.resume();
  }
  isPlaying = true;
}

export function pause(): void {
  hush();
  isPlaying = false;
}

export function getIsPlaying(): boolean {
  return isPlaying;
}

export function setIsPlaying(playing: boolean): void {
  isPlaying = playing;
}

