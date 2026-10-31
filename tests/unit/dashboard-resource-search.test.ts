import { describe, expect, it } from 'vitest'

import { resourceSearchPlaceholder } from '~/components/dashboard/resource/resourceFilters'

describe('resource search placeholder', () => {
  it('names what the default scope matches, without links', () => {
    expect(resourceSearchPlaceholder({})).toBe(
      '资源名称、备注、游戏名或资源 ID'
    )
    expect(resourceSearchPlaceholder({ searchField: 'all' })).not.toContain(
      '链接'
    )
  })

  it('follows the chosen search scope', () => {
    expect(resourceSearchPlaceholder({ searchField: 'text' })).toBe(
      '资源名称或备注'
    )
    expect(resourceSearchPlaceholder({ searchField: 'game' })).toBe('游戏名称')
    expect(resourceSearchPlaceholder({ searchField: 'link' })).toBe(
      '下载链接或 Hash'
    )
    expect(resourceSearchPlaceholder({ searchField: 'id' })).toBe('资源 ID')
  })

  it('falls back to the default for an unknown scope', () => {
    expect(resourceSearchPlaceholder({ searchField: 'nonsense' })).toBe(
      '资源名称、备注、游戏名或资源 ID'
    )
  })
})
