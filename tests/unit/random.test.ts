import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateUUID } from '~/utils/random'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateUUID', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a well-formed v4 UUID', () => {
    expect(generateUUID()).toMatch(UUID_V4)
  })

  it('does not repeat across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateUUID()))

    expect(ids.size).toBe(1000)
  })

  it('never calls crypto.randomUUID, which is missing outside secure contexts', () => {
    const randomUUID = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockImplementation(() => {
        throw new TypeError('crypto.randomUUID is not a function')
      })

    expect(generateUUID()).toMatch(UUID_V4)
    expect(randomUUID).not.toHaveBeenCalled()
  })
})
