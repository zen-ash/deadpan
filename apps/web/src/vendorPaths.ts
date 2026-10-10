/** Versioned URLs of the self-hosted wasm runtimes and models (see vendorAssets.ts). */
export interface VendorPaths {
  /** Folder holding vision_wasm_internal.{js,wasm}. */
  mediapipe: string;
  faceModel: string;
  /** Folder holding the Silero model and the vad-web AudioWorklet. */
  vad: string;
  /** Folder holding onnxruntime-web's wasm runtime. */
  ort: string;
}
