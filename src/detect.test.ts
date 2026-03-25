import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isBlurSupported, hasInsertableStreams } from './detect.js'

describe('isBlurSupported', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext
  })

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
    vi.unstubAllGlobals()
  })

  it('returns supported:true when WebGL2, WebAssembly, and Insertable Streams are available', () => {
    // jsdom provides document and HTMLCanvasElement; stub getContext to return a truthy WebGL2 context
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({}) as never

    vi.stubGlobal('MediaStreamTrackProcessor', function () {})
    vi.stubGlobal('MediaStreamTrackGenerator', function () {})

    const result = isBlurSupported()
    expect(result.supported).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('returns supported:true when WebGL2, WebAssembly, and captureStream are available', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({}) as never
    HTMLCanvasElement.prototype.captureStream = vi.fn() as never

    // jsdom lacks MediaStream and requestAnimationFrame — stub them for the fallback path
    vi.stubGlobal('MediaStream', function () {})
    vi.stubGlobal('requestAnimationFrame', vi.fn())

    // No Insertable Streams — rely on captureStream fallback
    const result = isBlurSupported()
    expect(result.supported).toBe(true)

    // Clean up
    delete (HTMLCanvasElement.prototype as Record<string, unknown>).captureStream
  })

  it('returns supported:false with reason when WebGL2 is missing', () => {
    // getContext('webgl2') returns null → no WebGL2
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null) as never

    const result = isBlurSupported()
    expect(result.supported).toBe(false)
    expect(result.reason).toContain('WebGL2')
  })

  it('returns supported:false with reason when WebAssembly is missing', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({}) as never
    vi.stubGlobal('WebAssembly', undefined)

    const result = isBlurSupported()
    expect(result.supported).toBe(false)
    expect(result.reason).toContain('WebAssembly')
  })

  it('returns supported:false when neither Insertable Streams nor captureStream are available', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({}) as never

    // Ensure no captureStream on the prototype
    delete (HTMLCanvasElement.prototype as Record<string, unknown>).captureStream

    const result = isBlurSupported()
    expect(result.supported).toBe(false)
    expect(result.reason).toContain('Insertable Streams')
    expect(result.reason).toContain('captureStream')
  })
})

describe('hasInsertableStreams', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true when both MediaStreamTrackProcessor and MediaStreamTrackGenerator are functions', () => {
    vi.stubGlobal('MediaStreamTrackProcessor', function () {})
    vi.stubGlobal('MediaStreamTrackGenerator', function () {})

    expect(hasInsertableStreams()).toBe(true)
  })

  it('returns false when MediaStreamTrackProcessor is missing', () => {
    vi.stubGlobal('MediaStreamTrackGenerator', function () {})

    expect(hasInsertableStreams()).toBe(false)
  })

  it('returns false when MediaStreamTrackGenerator is missing', () => {
    vi.stubGlobal('MediaStreamTrackProcessor', function () {})

    expect(hasInsertableStreams()).toBe(false)
  })

  it('returns false when both are missing', () => {
    expect(hasInsertableStreams()).toBe(false)
  })
})
