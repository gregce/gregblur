import { describe, it, expect, vi } from 'vitest'
import { createGregblurPipeline } from './pipeline.js'
import type { SegmentationProvider } from '../segmentation/types.js'

function createMockProvider(): SegmentationProvider {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    segment: vi.fn().mockReturnValue(null),
    destroy: vi.fn(),
  }
}

describe('createGregblurPipeline', () => {
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
})
