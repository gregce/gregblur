import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const createPipeline = () => ({
    init: vi.fn().mockResolvedValue(undefined),
    processFrame: vi.fn(),
    getCanvas: vi.fn(() => document.createElement('canvas')),
    getGL: vi.fn(() => null),
    setEnabled: vi.fn(),
    isEnabled: vi.fn(() => true),
    destroy: vi.fn(),
  })

  const createProvider = () => ({
    init: vi.fn(),
    segment: vi.fn(),
    destroy: vi.fn(),
  })

  return {
    createPipeline,
    createProvider,
    state: {
      pipeline: createPipeline(),
      provider: createProvider(),
    },
    createGregblurPipeline: vi.fn(),
    createMediaPipeProvider: vi.fn(),
    waitForDimensions: vi.fn(),
    supportsInsertableStreams: vi.fn(),
    startInsertableStreamsPipeline: vi.fn(),
    startRAFPipeline: vi.fn(),
    isAbortError: vi.fn(
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    ),
  }
})

vi.mock('../core/pipeline.js', () => ({
  createGregblurPipeline: mocks.createGregblurPipeline,
}))

vi.mock('../segmentation/mediapipe.js', () => ({
  createMediaPipeProvider: mocks.createMediaPipeProvider,
}))

vi.mock('./_pipelines.js', () => ({
  waitForDimensions: mocks.waitForDimensions,
  supportsInsertableStreams: mocks.supportsInsertableStreams,
  startInsertableStreamsPipeline: mocks.startInsertableStreamsPipeline,
  startRAFPipeline: mocks.startRAFPipeline,
  isAbortError: mocks.isAbortError,
}))

import { createLiveKitBlurProcessor } from './livekit.js'

function createTrack() {
  return {
    stop: vi.fn(),
  } as unknown as MediaStreamTrack
}

describe('createLiveKitBlurProcessor', () => {
  beforeEach(() => {
    mocks.state.pipeline = mocks.createPipeline()
    mocks.state.provider = mocks.createProvider()

    mocks.createGregblurPipeline.mockReset()
    mocks.createGregblurPipeline.mockReturnValue(mocks.state.pipeline)

    mocks.createMediaPipeProvider.mockReset()
    mocks.createMediaPipeProvider.mockReturnValue(mocks.state.provider)

    mocks.waitForDimensions.mockReset()
    mocks.waitForDimensions.mockResolvedValue({ w: 1920, h: 1080 })

    mocks.supportsInsertableStreams.mockReset()
    mocks.supportsInsertableStreams.mockReturnValue(true)

    mocks.startInsertableStreamsPipeline.mockReset()
    mocks.startRAFPipeline.mockReset()
    mocks.isAbortError.mockClear()
  })

  it('initialises and exposes the processed track via insertable streams', async () => {
    const inputTrack = createTrack()
    const outputTrack = createTrack()
    mocks.startInsertableStreamsPipeline.mockReturnValue(outputTrack)

    const processor = createLiveKitBlurProcessor()
    await processor.init({ track: inputTrack } as never)

    expect(processor.processedTrack).toBe(outputTrack)
    expect(mocks.waitForDimensions).toHaveBeenCalledWith(inputTrack, expect.any(AbortSignal))
    expect(mocks.state.pipeline.init).toHaveBeenCalledWith(1920, 1080)
    expect(mocks.startInsertableStreamsPipeline).toHaveBeenCalledWith(
      inputTrack,
      expect.any(AbortSignal),
      mocks.state.pipeline,
    )
  })

  it('uses the RAF pipeline when insertable streams are unavailable', async () => {
    const inputTrack = createTrack()
    const outputTrack = createTrack()
    const cleanup = vi.fn()

    mocks.supportsInsertableStreams.mockReturnValue(false)
    mocks.startRAFPipeline.mockReturnValue({ outputTrack, cleanup })

    const processor = createLiveKitBlurProcessor()
    await processor.init({ track: inputTrack } as never)

    expect(processor.processedTrack).toBe(outputTrack)
    expect(mocks.startRAFPipeline).toHaveBeenCalledWith(
      inputTrack,
      expect.any(AbortSignal),
      mocks.state.pipeline,
    )

    await processor.destroy()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(outputTrack.stop as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
    expect(processor.processedTrack).toBeUndefined()
  })

  it('restart() tears down the previous run before reinitialising', async () => {
    const inputTrack = createTrack()
    const firstOutput = createTrack()
    const secondOutput = createTrack()

    mocks.startInsertableStreamsPipeline
      .mockReturnValueOnce(firstOutput)
      .mockReturnValueOnce(secondOutput)

    const processor = createLiveKitBlurProcessor()
    await processor.init({ track: inputTrack } as never)
    await processor.restart({ track: inputTrack } as never)

    expect(firstOutput.stop as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
    expect(processor.processedTrack).toBe(secondOutput)
  })

  it('treats abort errors during init as a no-op', async () => {
    const abortError = new DOMException('Aborted', 'AbortError')
    mocks.waitForDimensions.mockRejectedValue(abortError)

    const processor = createLiveKitBlurProcessor()

    await expect(processor.init({ track: createTrack() } as never)).resolves.toBeUndefined()
    expect(processor.processedTrack).toBeUndefined()
    expect(mocks.state.pipeline.destroy).toHaveBeenCalledTimes(2)
  })

  it('delegates enablement to the underlying pipeline', () => {
    mocks.state.pipeline.isEnabled.mockReturnValue(false)

    const processor = createLiveKitBlurProcessor()
    processor.setEnabled(true)

    expect(mocks.state.pipeline.setEnabled).toHaveBeenCalledWith(true)
    expect(processor.isEnabled()).toBe(false)
  })

  it('uses a caller-supplied segmentation provider instead of creating MediaPipe', () => {
    const customProvider = {
      init: vi.fn(),
      segment: vi.fn(),
      destroy: vi.fn(),
    }

    createLiveKitBlurProcessor({
      segmentationProvider: customProvider,
    })

    expect(mocks.createMediaPipeProvider).not.toHaveBeenCalled()
    expect(mocks.createGregblurPipeline).toHaveBeenCalledWith(customProvider, {
      segmentationProvider: customProvider,
    })
  })
})
