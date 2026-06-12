import { describe, expect, it } from 'vitest'
import { getStaticGenerationLimit } from '~/config/staticGeneration'

describe('getStaticGenerationLimit', () => {
  it('falls back when the value is missing or invalid', () => {
    expect(getStaticGenerationLimit(undefined, 50)).toBe(50)
    expect(getStaticGenerationLimit('', 50)).toBe(50)
    expect(getStaticGenerationLimit('abc', 50)).toBe(50)
    expect(getStaticGenerationLimit('-1', 50)).toBe(50)
  })

  it('allows zero to disable build-time pre-generation', () => {
    expect(getStaticGenerationLimit('0', 50)).toBe(0)
  })

  it('floors positive numeric values', () => {
    expect(getStaticGenerationLimit('25.8', 50)).toBe(25)
  })
})
