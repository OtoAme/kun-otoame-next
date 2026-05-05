import { describe, expect, it } from 'vitest'
import { sanitizeSearchData } from '~/store/searchStore'

describe('sanitizeSearchData', () => {
  it('keeps valid nested search history from the current store shape', () => {
    const data = sanitizeSearchData({
      searchHistory: [
        [
          {
            type: 'keyword',
            mode: 'include',
            name: '月姬'
          },
          {
            type: 'tag',
            mode: 'exclude',
            id: 7,
            name: 'R18'
          }
        ]
      ],
      searchInIntroduction: true,
      searchInAlias: false,
      searchInTag: true
    })

    expect(data).toEqual({
      searchHistory: [
        [
          {
            type: 'keyword',
            mode: 'include',
            name: '月姬'
          },
          {
            type: 'tag',
            mode: 'exclude',
            id: 7,
            name: 'R18'
          }
        ]
      ],
      searchInIntroduction: true,
      searchInAlias: false,
      searchInTag: true
    })
  })

  it('migrates a flat legacy search history into nested entries', () => {
    const data = sanitizeSearchData({
      searchHistory: [
        {
          type: 'keyword',
          name: '樱之诗'
        },
        {
          type: 'company',
          mode: 'exclude',
          id: 3,
          name: '枕'
        }
      ]
    })

    expect(data.searchHistory).toEqual([
      [
        {
          type: 'keyword',
          mode: 'include',
          name: '樱之诗'
        }
      ],
      [
        {
          type: 'company',
          mode: 'exclude',
          id: 3,
          name: '枕'
        }
      ]
    ])
  })

  it('drops malformed persisted history instead of hydrating invalid arrays', () => {
    const data = sanitizeSearchData({
      searchHistory: [
        'old keyword',
        null,
        {
          type: 'tag',
          mode: 'include',
          name: ''
        },
        [
          {
            type: 'keyword',
            mode: 'include',
            name: '有效关键词'
          },
          {
            type: 'unknown',
            mode: 'include',
            name: '坏数据'
          }
        ]
      ],
      searchInIntroduction: 'yes',
      searchInAlias: true,
      searchInTag: 1
    })

    expect(data).toEqual({
      searchHistory: [
        [
          {
            type: 'keyword',
            mode: 'include',
            name: '有效关键词'
          }
        ]
      ],
      searchInIntroduction: false,
      searchInAlias: true,
      searchInTag: false
    })
  })
})
