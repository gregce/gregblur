/**
 * Core types for the gregblur pipeline.
 */

import type { SegmentationProvider } from '../segmentation/types.js'

/** Configuration for the gregblur WebGL2 pipeline. */
export interface GregblurOptions {
  /** Gaussian blur radius for the background. Default: 25 */
  blurRadius?: number
  /** Spatial sigma for joint bilateral filter. Default: 4.0 */
  bilateralSigmaSpace?: number
  /** Color sigma for joint bilateral filter. Default: 0.1 (range 0-1). */
  bilateralSigmaColor?: number
  /** Whether blur starts enabled. Default: true */
  initialEnabled?: boolean
  /** Background downsample factor. Default: 2 */
  downsampleFactor?: number
  /** Temporal blend factor for mask smoothing (0-1). Default: 0.24 */
  temporalBlendFactor?: number
}

/** Lifecycle interface for a gregblur pipeline instance. */
export interface GregblurPipeline {
  /**
   * Initialize the WebGL2 pipeline. Creates the canvas, compiles shaders,
   * allocates FBOs, and initialises the segmentation provider.
   * Must be called before processFrame().
   */
  init(width: number, height: number): Promise<void>

  /**
   * Process a single video frame through the full blur pipeline.
   * The result is rendered to the internal canvas.
   */
  processFrame(source: TexImageSource, timestampMs: number): void

  /** Get the output canvas (for reading pixels or capturing a stream). */
  getCanvas(): HTMLCanvasElement | OffscreenCanvas

  /** Get the WebGL2 context (for advanced use cases like shared textures). */
  getGL(): WebGL2RenderingContext | null

  /** Toggle blur on/off without destroying the pipeline. */
  setEnabled(enabled: boolean): void

  /** Check if blur is currently enabled. */
  isEnabled(): boolean

  /** Tear down all GPU resources and the segmentation provider. */
  destroy(): void
}

/** Internal FBO + texture pair used throughout the pipeline. */
export interface FBOWithTexture {
  fbo: WebGLFramebuffer
  texture: WebGLTexture
}

/** Arguments passed to createGregblurPipeline. */
export interface CreatePipelineArgs {
  provider: SegmentationProvider
  options?: GregblurOptions
}
