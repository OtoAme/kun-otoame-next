import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '~/app/api/edit/bangumi/route'

const fetchMock = vi.fn()

const request = (body: unknown) =>
  new Request('http://localhost/api/edit/bangumi', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as never

describe('Bangumi edit API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('returns summary so the client can copy it into introduction', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'original title',
        name_cn: '中文标题',
        summary: 'Bangumi summary',
        tags: [{ name: '乙女游戏' }],
        infobox: [{ key: '开发商', value: 'Studio' }]
      })
    })

    const response = await POST(request({ bangumiId: '172612' }))
    const json = await response.json()

    expect(json).toMatchObject({
      name: 'original title',
      nameCn: '中文标题',
      summary: 'Bangumi summary',
      tags: ['乙女游戏'],
      developers: ['Studio']
    })
  })
})
