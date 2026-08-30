import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchVndbVnMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/arnebiae/vndb', () => ({
  fetchVndbVn: fetchVndbVnMock
}))

import { POST } from '~/app/api/edit/vndb/details/route'

const request = (body: unknown) =>
  new Request('http://localhost/api/edit/vndb/details', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as never

describe('VNDB details API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not request or return VNDB tags', async () => {
    fetchVndbVnMock.mockResolvedValue({
      results: [
        {
          title: 'Game',
          titles: [{ lang: 'ja', title: 'ゲーム' }],
          aliases: ['Alias'],
          released: '2024-01-02',
          developers: [
            {
              id: 'p1',
              name: 'Studio',
              original: 'スタジオ',
              aliases: ['Alias Studio'],
              lang: 'ja',
              type: 'co',
              description: 'Producer description',
              extlinks: [{ url: 'https://studio.example.test' }]
            }
          ]
        }
      ]
    })

    const response = await POST(request({ vndbId: 'v123' }))
    const json = await response.json()

    expect(fetchVndbVnMock).toHaveBeenCalledWith(
      ['id', '=', 'v123'],
      'title, titles.lang, titles.title, aliases, released, developers{id,name,original,aliases,lang,type,description,extlinks{url}}'
    )
    expect(json).toEqual({
      titles: ['ゲーム', 'Game', 'Alias'],
      released: '2024-01-02',
      tags: [],
      developers: ['Studio'],
      producers: [
        {
          id: 'p1',
          name: 'Studio',
          original: 'スタジオ',
          aliases: ['Alias Studio'],
          lang: 'ja',
          type: 'co',
          description: 'Producer description',
          extlinks: [{ url: 'https://studio.example.test' }]
        }
      ]
    })
  })
})
