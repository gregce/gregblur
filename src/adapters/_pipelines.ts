/**
 * Shared track-processing pipelines used by both the LiveKit and raw adapters.
 *
 * Two paths:
 *   1. Insertable Streams (Chrome/Edge) — zero-copy via TransformStream
 *   2. RAF fallback (Safari/Firefox) — captureStream on a hidden canvas
 */

import type { GregblurPipeline } from '../core/types.js'

// ─── Types for the Insertable Streams API (not yet in lib.dom) ──────────────

export interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack
  maxBufferSize?: number
}

export interface MediaStreamTrackProcessorConstructor {
  new (init: MediaStreamTrackProcessorInit): {
    readable: ReadableStream<VideoFrame>
  }
}

export interface MediaStreamTrackGeneratorInit {
  kind: string
}

export interface MediaStreamTrackGeneratorConstructor {
  new (init: MediaStreamTrackGeneratorInit): MediaStreamTrack & {
    writable: WritableStream<VideoFrame>
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Wait for a track's dimensions to become available (up to 5 seconds). */
export async function waitForDimensions(
  track: MediaStreamTrack,
  signal: AbortSignal,
): Promise<{ w: number; h: number }> {
  for (let i = 0; i < 50; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const settings = track.getSettings()
    if (settings.width && settings.height) {
      return { w: settings.width, h: settings.height }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return { w: 640, h: 480 }
}

/** Check whether the browser supports the Insertable Streams API. */
export function supportsInsertableStreams(): boolean {
  const g = globalThis as typeof globalThis & {
    MediaStreamTrackProcessor?: unknown
    MediaStreamTrackGenerator?: unknown
  }
  return (
    typeof g.MediaStreamTrackProcessor === 'function' &&
    typeof g.MediaStreamTrackGenerator === 'function'
  )
}

// ─── Pipeline implementations ───────────────────────────────────────────

/**
 * Insertable Streams pipeline: reads frames from the source track via
 * MediaStreamTrackProcessor, processes each through the blur pipeline,
 * and writes to a MediaStreamTrackGenerator.
 */
export function startInsertableStreamsPipeline(
  sourceTrack: MediaStreamTrack,
  signal: AbortSignal,
  pipeline: GregblurPipeline,
): MediaStreamTrack {
  const MSTPConstructor = (
    globalThis as unknown as { MediaStreamTrackProcessor: MediaStreamTrackProcessorConstructor }
  ).MediaStreamTrackProcessor
  const MSTGConstructor = (
    globalThis as unknown as { MediaStreamTrackGenerator: MediaStreamTrackGeneratorConstructor }
  ).MediaStreamTrackGenerator

  const mstp = new MSTPConstructor({ track: sourceTrack, maxBufferSize: 1 })
  const generator = new MSTGConstructor({ kind: 'video' })

  const canvas = pipeline.getCanvas()
  const blurEnabled = () => pipeline.isEnabled()

  const transformer = new TransformStream<VideoFrame, VideoFrame>({
    transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
      let forwardedInputFrame = false
      try {
        if (signal.aborted) {
          frame.close()
          return
        }
        if (!blurEnabled()) {
          controller.enqueue(frame)
          forwardedInputFrame = true
          return
        }
        pipeline.processFrame(
          frame,
          frame.timestamp !== null ? frame.timestamp / 1000 : performance.now(),
        )

        if (canvas) {
          const outputFrame = new VideoFrame(canvas as OffscreenCanvas, {
            timestamp: frame.timestamp ?? 0,
          })
          controller.enqueue(outputFrame)
        }
      } catch (e) {
        console.warn('[gregblur] Frame transform error:', e)
      } finally {
        if (!forwardedInputFrame) {
          frame.close()
        }
      }
    },
  })

  mstp.readable.pipeThrough(transformer).pipeTo(generator.writable).catch((e: unknown) => {
    if ((e as DOMException)?.name !== 'AbortError') {
      console.warn('[gregblur] Pipeline error:', e)
    }
  })

  return generator as MediaStreamTrack
}

/**
 * RAF fallback pipeline: reads frames from a hidden video element using
 * requestVideoFrameCallback (or requestAnimationFrame), processes through
 * the blur pipeline, and captures output via canvas.captureStream().
 */
export function startRAFPipeline(
  sourceTrack: MediaStreamTrack,
  signal: AbortSignal,
  pipeline: GregblurPipeline,
): {
  outputTrack: MediaStreamTrack
  cleanup: () => void
} {
  let animFrameId: number | null = null
  let videoFrameCallbackId: number | null = null

  const video = document.createElement('video')
  video.srcObject = new MediaStream([sourceTrack])
  video.muted = true
  video.playsInline = true
  video.autoplay = true
  video.play().catch(() => {})

  const outputCanvas = pipeline.getCanvas() as HTMLCanvasElement
  if (!outputCanvas.isConnected) {
    // WebKit is more reliable when the captured canvas participates in page
    // rendering, even if it remains visually hidden.
    outputCanvas.dataset.gregblurFallback = 'true'
    outputCanvas.style.display = 'none'
    document.body.appendChild(outputCanvas)
  }
  const stream = outputCanvas.captureStream(30)
  const capturedTrack = stream.getVideoTracks()[0]

  function scheduleNextFrame(): void {
    if (signal.aborted) return
    if ('requestVideoFrameCallback' in video) {
      videoFrameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
        if (signal.aborted) return
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
          try {
            pipeline.processFrame(video, metadata.mediaTime * 1000)
          } catch (e) {
            console.warn('[gregblur] Frame error:', e)
          }
        }
        scheduleNextFrame()
      })
      return
    }

    animFrameId = requestAnimationFrame(tick)
  }

  function tick(): void {
    if (signal.aborted) return
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      try {
        pipeline.processFrame(video, performance.now())
      } catch (e) {
        console.warn('[gregblur] Frame error:', e)
      }
    }
    scheduleNextFrame()
  }

  scheduleNextFrame()

  return {
    outputTrack: capturedTrack,
    cleanup() {
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId)
        animFrameId = null
      }
      if (videoFrameCallbackId !== null) {
        video.cancelVideoFrameCallback(videoFrameCallbackId)
        videoFrameCallbackId = null
      }
      video.srcObject = null
    },
  }
}
