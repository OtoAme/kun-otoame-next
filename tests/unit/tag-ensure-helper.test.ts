import { describe, expect, it } from 'vitest'
import {
  buildTagLookupWhere,
  getCanonicalTagIds,
  hasTagName,
  mapTagNamesToIds
} from '~/app/api/edit/tagEnsureHelper'

describe('tagEnsureHelper', () => {
  it('builds name or alias lookup filters for each submitted tag', () => {
    expect(buildTagLookupWhere(['纯爱', '悬疑'])).toEqual({
      OR: [
        { OR: [{ name: '纯爱' }, { alias: { has: '纯爱' } }] },
        { OR: [{ name: '悬疑' }, { alias: { has: '悬疑' } }] }
      ]
    })
  })

  it('uses alias matches as canonical ids when an alias was also created as a tag', () => {
    const lookup = mapTagNamesToIds([
      { id: 1, name: '纯爱', alias: ['純愛'] },
      { id: 2, name: '純愛', alias: [] }
    ])

    expect(lookup.get('纯爱')).toBe(1)
    expect(lookup.get('純愛')).toBe(1)
  })

  it('does not map ambiguous aliases even when an alias tag exists', () => {
    const lookup = mapTagNamesToIds([
      { id: 1, name: '主标签 A', alias: ['别名'] },
      { id: 2, name: '主标签 B', alias: ['别名'] },
      { id: 3, name: '别名', alias: [] }
    ])

    expect(lookup.get('别名')).toBeUndefined()
  })

  it('deduplicates canonical ids resolved from names and aliases', () => {
    const lookup = mapTagNamesToIds([
      { id: 1, name: '纯爱', alias: ['純愛'] },
      { id: 3, name: '悬疑', alias: [] }
    ])

    expect(getCanonicalTagIds(['纯爱', '純愛', '悬疑'], lookup)).toEqual([1, 3])
  })

  it('matches a tag by its name or aliases', () => {
    expect(
      hasTagName({ name: '纯爱', alias: ['純愛'] }, new Set(['純愛']))
    ).toBe(true)
  })
})
