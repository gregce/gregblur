/**
 * Browser capability detection for gregblur.
 *
 * Checks whether the current environment has the APIs needed to run the
 * WebGL2 blur pipeline: WebGL2, WebAssembly, and either Insertable Streams
 * or canvas captureStream as a fallback.
 *
 * This intentionally does NOT include application-specific policy checks
 * (e.g. "only Chrome", "only desktop"). Consumers should layer their own
 * trust/policy decisions on top of this result.
 */

export interface BlurSupportResult {
  /** Whether the browser has the required APIs for gregblur. */
  supported: boolean
  /** Human-readable reason if unsupported. */
  reason?: string
}

function hasCanvasFallbackSupport(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLVideoElement !== 'undefined' &&
    typeof MediaStream !== 'undefined' &&
    typeof requestAnimationFrame === 'function' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  )
}

/**
 * Check whether the current browser supports the gregblur pipeline.
 *
 * Tests for:
 * - WebGL2 rendering context
 * - WebAssembly (required for MediaPipe WASM inference)
 * - Insertable Streams API (MediaStreamTrackProcessor + Generator)
 *   OR canvas captureStream fallback
 */
export function isBlurSupported(): BlurSupportResult {
  try {
    // WebGL2
    const testCanvas =
      typeof document !== 'undefined'
        ? document.createElement('canvas')
        : typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(1, 1)
          : null

    if (!testCanvas) {
      return { supported: false, reason: 'Canvas APIs not available' }
    }

    const testGl = testCanvas.getContext('webgl2')
    if (!testGl) {
      return { supported: false, reason: 'WebGL2 not available' }
    }

    // WebAssembly
    if (typeof WebAssembly === 'undefined') {
      return { supported: false, reason: 'WebAssembly not available' }
    }

    // Track processing: prefer Insertable Streams, fall back to captureStream
    const g = globalThis as typeof globalThis & {
      MediaStreamTrackProcessor?: unknown
      MediaStreamTrackGenerator?: unknown
    }
    const hasInsertableStreams =
      typeof g.MediaStreamTrackProcessor === 'function' &&
      typeof g.MediaStreamTrackGenerator === 'function'

    const hasCanvasFallback = hasCanvasFallbackSupport()

    if (!hasInsertableStreams && !hasCanvasFallback) {
      return {
        supported: false,
        reason: 'Neither Insertable Streams nor canvas captureStream available',
      }
    }

    return { supported: true }
  } catch {
    return { supported: false, reason: 'Detection failed with an exception' }
  }
}

/**
 * Check whether the browser supports the Insertable Streams API
 * (the preferred, zero-copy frame processing path).
 */
export function hasInsertableStreams(): boolean {
  const g = globalThis as typeof globalThis & {
    MediaStreamTrackProcessor?: unknown
    MediaStreamTrackGenerator?: unknown
  }
  return (
    typeof g.MediaStreamTrackProcessor === 'function' &&
    typeof g.MediaStreamTrackGenerator === 'function'
  )
}
