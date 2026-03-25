/**
 * LiveKit TrackProcessor adapter for gregblur.
 *
 * Drop-in replacement for @livekit/track-processors background blur.
 * Import from 'gregblur/livekit' — livekit-client is an optional peer dependency.
 */

import type { Track, TrackProcessor, ProcessorOptions } from 'livekit-client'
import type { GregblurOptions } from '../core/types.js'
import type { SegmentationProvider } from '../segmentation/types.js'
import type { MediaPipeModel } from '../segmentation/mediapipe.js'
import { createGregblurPipeline } from '../core/pipeline.js'
import { createMediaPipeProvider } from '../segmentation/mediapipe.js'
import {
  waitForDimensions,
  supportsInsertableStreams,
  startInsertableStreamsPipeline,
  startRAFPipeline,
} from './_pipelines.js'

/** LiveKit-specific processor interface with blur toggle. */
export interface LiveKitBlurProcessor
  extends TrackProcessor<Track.Kind, ProcessorOptions<Track.Kind>> {
  setEnabled(enabled: boolean): void
  isEnabled(): boolean
}

/** Options for createLiveKitBlurProcessor. */
export interface CreateLiveKitBlurOptions extends GregblurOptions {
  /** MediaPipe model to use. Default: 'selfie-multiclass-256' */
  segmentationModel?: MediaPipeModel
  /** Provide a custom segmentation provider instead of MediaPipe. */
  segmentationProvider?: SegmentationProvider
}

/**
 * Creates a LiveKit TrackProcessor that applies high-quality background blur.
 *
 * Uses the full gregblur pipeline: confidence masks, joint bilateral filtering,
 * temporal smoothing, mask-weighted blur, and foreground-biased compositing.
 *
 * @param options - Optional configuration
 * @returns A TrackProcessor compatible with LiveKit's `track.setProcessor()` API
 */
export function createLiveKitBlurProcessor(
  options?: CreateLiveKitBlurOptions,
): LiveKitBlurProcessor {
  const segProvider =
    options?.segmentationProvider ??
    createMediaPipeProvider({ model: options?.segmentationModel })

  const pipeline = createGregblurPipeline(segProvider, options)

  // Track pipeline lifecycle state
  let abortController: AbortController | null = null
  let outputTrack: MediaStreamTrack | null = null
  let rafCleanup: (() => void) | null = null

  const processor: LiveKitBlurProcessor = {
    name: 'gregblur',

    async init(opts: ProcessorOptions<Track.Kind>): Promise<void> {
      abortController = new AbortController()
      const { signal } = abortController

      const { w, h } = await waitForDimensions(opts.track, signal)
      await pipeline.init(w, h)

      // Start the appropriate frame pipeline
      if (supportsInsertableStreams()) {
        outputTrack = startInsertableStreamsPipeline(opts.track, signal, pipeline)
      } else {
        const result = startRAFPipeline(opts.track, signal, pipeline)
        outputTrack = result.outputTrack
        rafCleanup = result.cleanup
      }

      processor.processedTrack = outputTrack
    },

    async restart(opts: ProcessorOptions<Track.Kind>): Promise<void> {
      await processor.destroy()
      await processor.init(opts)
    },

    async destroy(): Promise<void> {
      abortController?.abort()
      abortController = null

      rafCleanup?.()
      rafCleanup = null

      if (outputTrack) {
        outputTrack.stop()
        outputTrack = null
      }
      processor.processedTrack = undefined

      pipeline.destroy()
    },

    setEnabled(enabled: boolean): void {
      pipeline.setEnabled(enabled)
    },

    isEnabled(): boolean {
      return pipeline.isEnabled()
    },

    processedTrack: undefined,
  }

  return processor
}
