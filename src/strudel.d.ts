declare module "@strudel/web" {
  export function initStrudel(options?: Record<string, unknown>): Promise<unknown>;
  export function evaluate(code: string, play?: boolean): Promise<unknown>;
  export function hush(): void;
  export function getAudioContext(): AudioContext;
  export function getAnalyserById(id: number, fftSize?: number): AnalyserNode;
}
