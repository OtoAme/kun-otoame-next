import { afterEach, describe, expect, it, vi } from 'vitest'

describe('postToIndexNow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('bounds and swallows IndexNow failures because publishing has already succeeded', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network timeout'))
    vi.stubGlobal('fetch', fetchMock)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { postToIndexNow } = await import('~/app/api/edit/_postToIndexNow')

    await expect(postToIndexNow('https://www.otogame.org/abc12345')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.bing.com/indexnow',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal)
      })
    )
    expect(consoleSpy).toHaveBeenCalledWith(
      '[IndexNow] Post failed:',
      expect.any(Error)
    )
  })
})
