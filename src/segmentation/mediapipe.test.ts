import { describe, it, expect } from 'vitest'
import { createMediaPipeProvider } from './mediapipe.js'

describe('createMediaPipeProvider', () => {
  it('returns an object with init, segment, and destroy methods', () => {
    const provider = createMediaPipeProvider()

    expect(typeof provider.init).toBe('function')
    expect(typeof provider.segment).toBe('function')
    expect(typeof provider.destroy).toBe('function')
  })

  it('accepts custom options without throwing', () => {
    const provider = createMediaPipeProvider({
      model: 'selfie-segmenter',
      mediapipeVersion: '0.10.12',
    })

    expect(typeof provider.init).toBe('function')
    expect(typeof provider.segment).toBe('function')
    expect(typeof provider.destroy).toBe('function')
  })

  it('segment() returns null before init() is called', () => {
    const provider = createMediaPipeProvider()

    // Before init, the internal segmenter is null so segment should return null
    const result = provider.segment({} as TexImageSource, 0)
    expect(result).toBeNull()
  })

  it('destroy() can be called safely before init()', () => {
    const provider = createMediaPipeProvider()

    // Should not throw
    expect(() => provider.destroy()).not.toThrow()
  })

  it('destroy() can be called multiple times without throwing', () => {
    const provider = createMediaPipeProvider()

    expect(() => provider.destroy()).not.toThrow()
    expect(() => provider.destroy()).not.toThrow()
  })
})
