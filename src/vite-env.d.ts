/// <reference types="vite/client" />

import type { OmniSynthBridge } from "../shared/ipc";

declare global {
  interface Window {
    /** Desktop bridge exposed by electron/preload.ts; undefined when running in a plain browser. */
    omnisynth?: OmniSynthBridge;
  }
}

export {};
