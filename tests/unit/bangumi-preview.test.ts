import { describe, expect, it } from 'vitest'

import {
  getBangumiPreferredTitle,
  removeTitleFromAliases
} from '~/utils/bangumiPreview'

describe('Bangumi preview helpers', () => {
  it('prefers the Chinese title when inserting a Bangumi title', () => {
    expect(
      getBangumiPreferredTitle({
        name: 'Original Title',
        nameCn: '中文标题'
      })
    ).toBe('中文标题')
  })

  it('falls back to the original title when the Chinese title is empty', () => {
    expect(
      getBangumiPreferredTitle({
        name: 'Original Title',
        nameCn: ' '
      })
    ).toBe('Original Title')
  })

  it('removes the inserted title from aliases', () => {
    expect(
      removeTitleFromAliases(['原名', '中文标题', '别名'], '中文标题')
    ).toEqual(['原名', '别名'])
  })
})
