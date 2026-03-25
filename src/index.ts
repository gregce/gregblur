/**
 * gregblur — High-quality WebGL2 background blur for video streams.
 *
 * Main entry point. Re-exports the core pipeline and the default
 * MediaPipe segmentation provider. For framework-specific adapters,
 * import from 'gregblur/livekit' or 'gregblur/raw'.
 */

// Core pipeline
export { createGregblurPipeline } from './core/pipeline.js'
export type { GregblurPipeline, GregblurOptions, FBOWithTexture } from './core/types.js'

// Segmentation
export { createMediaPipeProvider } from './segmentation/mediapipe.js'
export type { SegmentationProvider, SegmentationResult } from './segmentation/types.js'
export type { MediaPipeProviderOptions, MediaPipeModel } from './segmentation/mediapipe.js'
