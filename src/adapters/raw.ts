/**
 * Framework-agnostic MediaStreamTrack adapter for gregblur.
 *
 * Takes a raw MediaStreamTrack (e.g. from getUserMedia) and returns a
 * processed MediaStreamTrack with background blur applied. Works with
 * any WebRTC stack — no LiveKit, Twilio, or Daily dependency needed.
 *
 * Import from 'gregblur/raw'.
 */

import type { GregblurOptions } from '../core/types.js'
import type { SegmentationProvider } from '../segmentation/types.js'
import type { MediaPipeModel } from '../segmentation/mediapipe.js'
import { createGregblurPipeline } from '../core/pipeline.js'
import { createMediaPipeProvider } from '../segmentation/mediapipe.js'
import {
  waitForDimensions,
  isAbortError,
  supportsInsertableStreams,
  startInsertableStreamsPipeline,
  startRAFPipeline,
} from './_pipelines.js'

/** Raw blur processor interface. */
export interface RawBlurProcessor {
  /** Start processing the input track and return a blurred output track. */
  start(inputTrack: MediaStreamTrack): Promise<MediaStreamTrack>
  /** Toggle blur on/off without destroying the pipeline. */
  setEnabled(enabled: boolean): void
  /** Check if blur is currently enabled. */
  isEnabled(): boolean
  /** Stop processing and release all resources. */
  destroy(): Promise<void>
}

/** Options for createRawBlurProcessor. */
export interface CreateRawBlurOptions extends GregblurOptions {
  /** MediaPipe model to use. Default: 'selfie-multiclass-256' */
  segmentationModel?: MediaPipeModel
  /** Provide a custom segmentation provider instead of MediaPipe. */
  segmentationProvider?: SegmentationProvider
}

/**
 * Creates a framework-agnostic blur processor for raw MediaStreamTracks.
 *
 * @param options - Optional configuration
 * @returns A processor with start/destroy lifecycle
 */
export function createRawBlurProcessor(
  options?: CreateRawBlurOptions,
): RawBlurProcessor {
  const segProvider =
    options?.segmentationProvider ??
    createMediaPipeProvider({ model: options?.segmentationModel })

  const pipeline = createGregblurPipeline(segProvider, options)

  let abortController: AbortController | null = null
  let outputTrack: MediaStreamTrack | null = null
  let rafCleanup: (() => void) | null = null

  function cleanupActiveRun(): void {
    abortController?.abort()
    abortController = null

    rafCleanup?.()
    rafCleanup = null

    if (outputTrack) {
      outputTrack.stop()
      outputTrack = null
    }

    pipeline.destroy()
  }

  const processor: RawBlurProcessor = {
    async start(inputTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
      cleanupActiveRun()

      const controller = new AbortController()
      abortController = controller
      const { signal } = controller

      try {
        const { w, h } = await waitForDimensions(inputTrack, signal)
        await pipeline.init(w, h)

        if (supportsInsertableStreams()) {
          outputTrack = startInsertableStreamsPipeline(inputTrack, signal, pipeline)
        } else {
          const result = startRAFPipeline(inputTrack, signal, pipeline)
          outputTrack = result.outputTrack
          rafCleanup = result.cleanup
        }

        return outputTrack
      } catch (error) {
        if (abortController === controller) {
          cleanupActiveRun()
        }
        if (isAbortError(error)) {
          throw error
        }
        throw error
      }
    },

    setEnabled(enabled: boolean): void {
      pipeline.setEnabled(enabled)
    },

    isEnabled(): boolean {
      return pipeline.isEnabled()
    },

    async destroy(): Promise<void> {
      cleanupActiveRun()
    },
  }

  return processor
}
