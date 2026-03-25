/**
 * Default segmentation provider using MediaPipe's selfie segmentation models.
 *
 * Loads @mediapipe/tasks-vision dynamically (from CDN by default) and runs
 * the ImageSegmenter in VIDEO mode with GPU delegation. The confidence mask
 * is returned as a WebGL texture on the same context as the pipeline canvas.
 */

import type { SegmentationProvider, SegmentationResult } from './types.js'

const MEDIAPIPE_VERSION = '0.10.14'
const DEFAULT_WASM_BASE_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`

const SEGMENTATION_MODEL_URLS = {
  'selfie-multiclass-256':
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  'selfie-segmenter':
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
} as const

export type MediaPipeModel = keyof typeof SEGMENTATION_MODEL_URLS

/** Configuration for the MediaPipe segmentation provider. */
export interface MediaPipeProviderOptions {
  /** Segmentation model to use. Default: 'selfie-multiclass-256' */
  model?: MediaPipeModel
  /** Override the MediaPipe WASM version loaded from CDN. Default: '0.10.14' */
  mediapipeVersion?: string
  /** Override the WASM base path (for self-hosted deployments). */
  wasmBasePath?: string
  /** Override the model URL (for self-hosted model files). */
  modelUrl?: string
}

/**
 * Creates a SegmentationProvider backed by MediaPipe's ImageSegmenter.
 *
 * The provider dynamically imports @mediapipe/tasks-vision at init time,
 * so no npm dependency on mediapipe is required — it loads from CDN.
 */
export function createMediaPipeProvider(
  options?: MediaPipeProviderOptions,
): SegmentationProvider {
  const model = options?.model ?? 'selfie-multiclass-256'
  const modelUrl = options?.modelUrl ?? SEGMENTATION_MODEL_URLS[model]
  const version = options?.mediapipeVersion ?? MEDIAPIPE_VERSION
  const wasmBasePath =
    options?.wasmBasePath ??
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let segmenter: any = null
  let lastTimestampMs = -1

  /**
   * Ensure timestamps are strictly monotonically increasing — MediaPipe's
   * VIDEO mode rejects non-increasing values.
   */
  function getMonotonicTimestamp(rawTimestamp: number): number {
    const normalised = Number.isFinite(rawTimestamp)
      ? Math.max(0, Math.floor(rawTimestamp))
      : 0
    const next =
      normalised <= lastTimestampMs ? lastTimestampMs + 1 : normalised
    lastTimestampMs = next
    return next
  }

  return {
    async init(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
      // Reset timestamp state so re-init after destroy works correctly
      lastTimestampMs = -1

      // Dynamic import — works whether the consumer has @mediapipe/tasks-vision
      // installed locally or the bundler resolves from CDN.
      const vision = await import('@mediapipe/tasks-vision')
      const wasmFileset = await vision.FilesetResolver.forVisionTasks(
        wasmBasePath,
      )

      segmenter = await vision.ImageSegmenter.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
        canvas: canvas,
      })

      lastTimestampMs = -1
    },

    segment(
      source: TexImageSource,
      timestampMs: number,
    ): SegmentationResult | null {
      if (!segmenter) return null

      const result = segmenter.segmentForVideo(
        source,
        getMonotonicTimestamp(timestampMs),
      )

      // confidenceMasks[0] = background confidence (1.0 = definitely background)
      if (!result?.confidenceMasks?.[0]) {
        result?.close?.()
        return null
      }

      const confidenceTexture: WebGLTexture =
        result.confidenceMasks[0].getAsWebGLTexture()

      return {
        confidenceTexture,
        close() {
          result.close?.()
        },
      }
    },

    destroy(): void {
      if (segmenter) {
        try {
          segmenter.close()
        } catch {
          // Ignore errors during cleanup
        }
        segmenter = null
      }
      lastTimestampMs = -1
    },
  }
}
