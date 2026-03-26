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

import { createRawBlurProcessor } from './raw.js'

function createTrack() {
  return {
    stop: vi.fn(),
  } as unknown as MediaStreamTrack
}

describe('createRawBlurProcessor', () => {
  beforeEach(() => {
    mocks.state.pipeline = mocks.createPipeline()
    mocks.state.provider = mocks.createProvider()

    mocks.createGregblurPipeline.mockReset()
    mocks.createGregblurPipeline.mockReturnValue(mocks.state.pipeline)

    mocks.createMediaPipeProvider.mockReset()
    mocks.createMediaPipeProvider.mockReturnValue(mocks.state.provider)

    mocks.waitForDimensions.mockReset()
    mocks.waitForDimensions.mockResolvedValue({ w: 1280, h: 720 })

    mocks.supportsInsertableStreams.mockReset()
    mocks.supportsInsertableStreams.mockReturnValue(true)

    mocks.startInsertableStreamsPipeline.mockReset()
    mocks.startRAFPipeline.mockReset()
    mocks.isAbortError.mockClear()
  })

  it('starts with the insertable streams path when available', async () => {
    const inputTrack = createTrack()
    const outputTrack = createTrack()
    mocks.startInsertableStreamsPipeline.mockReturnValue(outputTrack)

    const processor = createRawBlurProcessor()
    const result = await processor.start(inputTrack)

    expect(result).toBe(outputTrack)
    expect(mocks.createMediaPipeProvider).toHaveBeenCalledTimes(1)
    expect(mocks.waitForDimensions).toHaveBeenCalledWith(inputTrack, expect.any(AbortSignal))
    expect(mocks.state.pipeline.init).toHaveBeenCalledWith(1280, 720)
    expect(mocks.startInsertableStreamsPipeline).toHaveBeenCalledWith(
      inputTrack,
      expect.any(AbortSignal),
      mocks.state.pipeline,
    )
    expect(mocks.startRAFPipeline).not.toHaveBeenCalled()
  })

  it('falls back to the RAF pipeline when insertable streams are unavailable', async () => {
    const inputTrack = createTrack()
    const outputTrack = createTrack()
    const cleanup = vi.fn()

    mocks.supportsInsertableStreams.mockReturnValue(false)
    mocks.startRAFPipeline.mockReturnValue({ outputTrack, cleanup })

    const processor = createRawBlurProcessor()
    const result = await processor.start(inputTrack)

    expect(result).toBe(outputTrack)
    expect(mocks.startRAFPipeline).toHaveBeenCalledWith(
      inputTrack,
      expect.any(AbortSignal),
      mocks.state.pipeline,
    )

    await processor.destroy()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(outputTrack.stop as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
  })

  it('cleans up the previous run before starting a new one', async () => {
    const inputTrack = createTrack()
    const firstOutput = createTrack()
    const secondOutput = createTrack()
    const firstCleanup = vi.fn()
    const secondCleanup = vi.fn()

    mocks.supportsInsertableStreams.mockReturnValue(false)
    mocks.startRAFPipeline
      .mockReturnValueOnce({ outputTrack: firstOutput, cleanup: firstCleanup })
      .mockReturnValueOnce({ outputTrack: secondOutput, cleanup: secondCleanup })

    const processor = createRawBlurProcessor()
    await processor.start(inputTrack)
    const restartedOutput = await processor.start(inputTrack)

    expect(restartedOutput).toBe(secondOutput)
    expect(firstCleanup).toHaveBeenCalledTimes(1)
    expect(firstOutput.stop as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
  })

  it('rethrows abort errors during startup after cleanup', async () => {
    const abortError = new DOMException('Aborted', 'AbortError')
    mocks.waitForDimensions.mockRejectedValue(abortError)

    const processor = createRawBlurProcessor()

    await expect(processor.start(createTrack())).rejects.toThrow('Aborted')
    expect(mocks.state.pipeline.destroy).toHaveBeenCalledTimes(2)
    expect(mocks.startInsertableStreamsPipeline).not.toHaveBeenCalled()
    expect(mocks.startRAFPipeline).not.toHaveBeenCalled()
  })

  it('delegates enablement to the underlying pipeline', () => {
    mocks.state.pipeline.isEnabled.mockReturnValue(false)

    const processor = createRawBlurProcessor()
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

    createRawBlurProcessor({
      segmentationProvider: customProvider,
    })

    expect(mocks.createMediaPipeProvider).not.toHaveBeenCalled()
    expect(mocks.createGregblurPipeline).toHaveBeenCalledWith(customProvider, {
      segmentationProvider: customProvider,
    })
  })
})
