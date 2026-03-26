import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGregblurPipeline } from './pipeline.js'
import { createMockWebGLContext } from '../test-helpers/mock-webgl.js'
import type { SegmentationProvider } from '../segmentation/types.js'

function createMockProvider(): SegmentationProvider {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    segment: vi.fn().mockReturnValue(null),
    destroy: vi.fn(),
  }
}

function createSegmentationResult() {
  return {
    confidenceTexture: { kind: 'confidence-texture' } as unknown as WebGLTexture,
    close: vi.fn(),
  }
}

describe('createGregblurPipeline', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext
  })

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
    vi.restoreAllMocks()
  })

  it('returns an object with all GregblurPipeline methods', () => {
    const pipeline = createGregblurPipeline(createMockProvider())

    expect(typeof pipeline.init).toBe('function')
    expect(typeof pipeline.processFrame).toBe('function')
    expect(typeof pipeline.getCanvas).toBe('function')
    expect(typeof pipeline.getGL).toBe('function')
    expect(typeof pipeline.setEnabled).toBe('function')
    expect(typeof pipeline.isEnabled).toBe('function')
    expect(typeof pipeline.destroy).toBe('function')
  })

  it('isEnabled() returns true by default', () => {
    const pipeline = createGregblurPipeline(createMockProvider())
    expect(pipeline.isEnabled()).toBe(true)
  })

  it('isEnabled() returns false when initialEnabled is false', () => {
    const pipeline = createGregblurPipeline(createMockProvider(), {
      initialEnabled: false,
    })
    expect(pipeline.isEnabled()).toBe(false)
  })

  it('setEnabled/isEnabled toggles blur state', () => {
    const pipeline = createGregblurPipeline(createMockProvider())

    expect(pipeline.isEnabled()).toBe(true)

    pipeline.setEnabled(false)
    expect(pipeline.isEnabled()).toBe(false)

    pipeline.setEnabled(true)
    expect(pipeline.isEnabled()).toBe(true)
  })

  it('getCanvas() throws before init()', () => {
    const pipeline = createGregblurPipeline(createMockProvider())

    expect(() => pipeline.getCanvas()).toThrow('not initialised')
  })

  it('getGL() returns null before init()', () => {
    const pipeline = createGregblurPipeline(createMockProvider())

    expect(pipeline.getGL()).toBeNull()
  })

  it('destroy() can be called before init() without throwing', () => {
    const provider = createMockProvider()
    const pipeline = createGregblurPipeline(provider)

    expect(() => pipeline.destroy()).not.toThrow()
    expect(provider.destroy).toHaveBeenCalled()
  })

  it('init() creates a canvas, initialises the provider, and exposes the GL context', async () => {
    const gl = createMockWebGLContext()
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(gl) as never

    const provider = createMockProvider()
    const pipeline = createGregblurPipeline(provider)
    await pipeline.init(640, 480)

    const canvas = pipeline.getCanvas()
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect(canvas.width).toBe(640)
    expect(canvas.height).toBe(480)
    expect(pipeline.getGL()).toBe(gl)
    expect(provider.init).toHaveBeenCalledWith(canvas)

    pipeline.destroy()
    expect(provider.destroy).toHaveBeenCalled()
    expect(gl.__loseContext).toHaveBeenCalled()
  })

  it('re-initialising tears down the previous pipeline before creating a new canvas', async () => {
    const gl = createMockWebGLContext()
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(gl) as never

    const provider = createMockProvider()
    const pipeline = createGregblurPipeline(provider)

    await pipeline.init(640, 480)
    const firstCanvas = pipeline.getCanvas()

    await pipeline.init(320, 240)
    const secondCanvas = pipeline.getCanvas()

    expect(provider.destroy).toHaveBeenCalledTimes(1)
    expect(provider.init).toHaveBeenCalledTimes(2)
    expect(secondCanvas).not.toBe(firstCanvas)
    expect(secondCanvas.width).toBe(320)
    expect(secondCanvas.height).toBe(240)
  })

  it('skips segmentation entirely when blur is disabled', async () => {
    const gl = createMockWebGLContext()
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(gl) as never

    const provider = createMockProvider()
    const pipeline = createGregblurPipeline(provider)
    await pipeline.init(640, 480)

    pipeline.setEnabled(false)
    gl.__clearUseProgramCalls()

    const source = document.createElement('canvas')
    source.width = 640
    source.height = 480
    pipeline.processFrame(source, 100)

    expect(provider.segment).not.toHaveBeenCalled()
    expect(gl.__getUseProgramIds()).toEqual([3, 4])
  })

  it('falls back to the oriented source frame when segmentation returns null', async () => {
    const gl = createMockWebGLContext()
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(gl) as never

    const provider = createMockProvider()
    provider.segment = vi.fn().mockReturnValue(null)

    const pipeline = createGregblurPipeline(provider)
    await pipeline.init(640, 480)
    gl.__clearUseProgramCalls()

    const source = document.createElement('canvas')
    source.width = 320
    source.height = 240
    pipeline.processFrame(source, 100)

    expect(provider.segment).toHaveBeenCalledWith(source, 100)
    expect(gl.__getUseProgramIds()).toEqual([3, 4])
    expect(pipeline.getCanvas().width).toBe(320)
    expect(pipeline.getCanvas().height).toBe(240)
  })

  it('uses temporal blending on subsequent blurred frames and resets it after toggling blur', async () => {
    const gl = createMockWebGLContext()
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(gl) as never

    const resultA = createSegmentationResult()
    const resultB = createSegmentationResult()
    const resultC = createSegmentationResult()
    const provider = createMockProvider()
    provider.segment = vi
      .fn()
      .mockReturnValueOnce(resultA)
      .mockReturnValueOnce(resultB)
      .mockReturnValueOnce(resultC)

    const pipeline = createGregblurPipeline(provider)
    await pipeline.init(640, 480)

    const source = document.createElement('canvas')
    source.width = 640
    source.height = 480

    gl.__clearUseProgramCalls()
    pipeline.processFrame(source, 100)
    expect(gl.__getUseProgramIds()).not.toContain(2)
    expect(resultA.close).toHaveBeenCalledTimes(1)

    gl.__clearUseProgramCalls()
    pipeline.processFrame(source, 101)
    expect(gl.__getUseProgramIds()).toContain(2)
    expect(resultB.close).toHaveBeenCalledTimes(1)

    pipeline.setEnabled(false)
    pipeline.setEnabled(true)

    gl.__clearUseProgramCalls()
    pipeline.processFrame(source, 102)
    expect(gl.__getUseProgramIds()).not.toContain(2)
    expect(resultC.close).toHaveBeenCalledTimes(1)
  })

  it('logs and falls back cleanly when processing fails after segmentation', async () => {
    const gl = createMockWebGLContext()
    gl.__setFailProgramId(1)
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(gl) as never

    const result = createSegmentationResult()
    const provider = createMockProvider()
    provider.segment = vi.fn().mockReturnValue(result)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const pipeline = createGregblurPipeline(provider)
    await pipeline.init(640, 480)
    gl.__clearUseProgramCalls()

    const source = document.createElement('canvas')
    source.width = 640
    source.height = 480

    expect(() => pipeline.processFrame(source, 100)).not.toThrow()

    expect(warnSpy).toHaveBeenCalledWith('[gregblur] Frame processing error:', expect.any(Error))
    expect(result.close).toHaveBeenCalledTimes(1)
    expect(gl.__getUseProgramIds()).toEqual([3, 1, 4])
  })
})
