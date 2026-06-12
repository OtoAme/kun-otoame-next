import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRealtimePatchStatsMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/views/buffer', () => ({
  getRealtimePatchStats: getRealtimePatchStatsMock
}))

import { GET } from '~/app/api/patch/stats/route'

const request = (uniqueIds: string) =>
  new Request(
    `https://www.otoame.top/api/patch/stats?uniqueIds=${encodeURIComponent(uniqueIds)}`
  )

describe('patch stats route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRealtimePatchStatsMock.mockResolvedValue({
      view: new Map<string, number>(),
      download: new Map<string, number>()
    })
  })

  it('returns realtime stats with no-store cache headers', async () => {
    getRealtimePatchStatsMock.mockResolvedValue({
      view: new Map([
        ['abc12345', 12],
        ['def67890', 20]
      ]),
      download: new Map([['abc12345', 5]])
    })

    const response = await GET(request('abc12345,def67890') as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(getRealtimePatchStatsMock).toHaveBeenCalledWith([
      'abc12345',
      'def67890'
    ])
    expect(await response.json()).toEqual({
      stats: {
        abc12345: { view: 12, download: 5 },
        def67890: { view: 20 }
      }
    })
  })

  it('rejects invalid unique ids without reading realtime stats', async () => {
    const response = await GET(request('abc12345,bad') as never)

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(getRealtimePatchStatsMock).not.toHaveBeenCalled()
  })
})
