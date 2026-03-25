/**
 * Pluggable segmentation provider interface.
 *
 * Implement this to swap MediaPipe for a different segmentation backend
 * (ONNX Runtime, TFLite, a custom WASM model, etc.).
 */

/** A segmentation result for a single frame. */
export interface SegmentationResult {
  /**
   * The background confidence mask as a WebGL texture.
   * Values: 1.0 = definitely background, 0.0 = definitely person.
   * The pipeline inverts this internally during bilateral filtering.
   */
  confidenceTexture: WebGLTexture
  /** Release resources associated with this result (e.g. MediaPipe mask handles). */
  close(): void
}

/** Provider that produces per-frame segmentation masks. */
export interface SegmentationProvider {
  /**
   * Initialize the segmentation model.
   * The canvas is passed so the provider can share the same WebGL2 context
   * as the pipeline (required for zero-copy texture access).
   */
  init(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void>

  /**
   * Segment a single frame and return the confidence mask texture.
   * @param source - The video frame to segment.
   * @param timestampMs - Monotonic timestamp in milliseconds.
   * @returns The segmentation result, or null if segmentation failed.
   */
  segment(source: TexImageSource, timestampMs: number): SegmentationResult | null

  /** Release all resources held by the provider. */
  destroy(): void
}
