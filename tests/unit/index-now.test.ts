import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postToIndexNow } from '~/app/api/edit/_postToIndexNow'

describe('IndexNow optional configuration', () => {
  const originalKey = process.env.KUN_VISUAL_NOVEL_INDEX_NOW_KEY

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 }))
    )
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.KUN_VISUAL_NOVEL_INDEX_NOW_KEY
    } else {
      process.env.KUN_VISUAL_NOVEL_INDEX_NOW_KEY = originalKey
    }
    vi.unstubAllGlobals()
  })

  it('does not contact the public endpoint when the key is explicitly empty', async () => {
    process.env.KUN_VISUAL_NOVEL_INDEX_NOW_KEY = ''

    await postToIndexNow('https://example.invalid/e2e')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends the configured key when IndexNow is enabled', async () => {
    process.env.KUN_VISUAL_NOVEL_INDEX_NOW_KEY = 'test-key'

    await postToIndexNow('https://example.invalid/e2e')

    expect(fetch).toHaveBeenCalledOnce()
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      key: 'test-key',
      urlList: ['https://example.invalid/e2e']
    })
  })
})
