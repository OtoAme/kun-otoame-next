import { describe, expect, it } from 'vitest'
import {
  buildAutoAliasMergePlan,
  getMergePreview,
  normalizeAliases
} from '~/scripts/tagMergePlan'

describe('tagMergePlan', () => {
  it('builds a merge when a tag name is another tag alias', () => {
    expect(
      buildAutoAliasMergePlan([
        { id: 1, name: '纯爱', alias: ['純愛'] },
        { id: 2, name: '純愛', alias: [] }
      ])
    ).toEqual({
      merges: [
        {
          targetTagId: 1,
          targetName: '纯爱',
          sourceTagIds: [2],
          sourceNames: ['純愛']
        }
      ],
      warnings: []
    })
  })

  it('resolves alias chains into the root target', () => {
    expect(
      buildAutoAliasMergePlan([
        { id: 1, name: 'A', alias: ['B'] },
        { id: 2, name: 'B', alias: ['C'] },
        { id: 3, name: 'C', alias: [] }
      ]).merges
    ).toEqual([
      {
        targetTagId: 1,
        targetName: 'A',
        sourceTagIds: [2, 3],
        sourceNames: ['B', 'C']
      }
    ])
  })

  it('skips ambiguous alias targets so production plans require manual review', () => {
    const result = buildAutoAliasMergePlan([
      { id: 1, name: '主标签 A', alias: ['别名'] },
      { id: 2, name: '主标签 B', alias: ['别名'] },
      { id: 3, name: '别名', alias: [] }
    ])

    expect(result.merges).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Skip ambiguous alias tag "别名"')
  })

  it('does not merge alias chains into an ambiguous alias tag', () => {
    const result = buildAutoAliasMergePlan([
      { id: 1, name: '主标签 A', alias: ['别名'] },
      { id: 2, name: '主标签 B', alias: ['别名'] },
      { id: 3, name: '别名', alias: ['链路别名'] },
      { id: 4, name: '链路别名', alias: [] }
    ])

    expect(result.merges).toEqual([])
    expect(result.warnings).toEqual([
      expect.stringContaining('Skip ambiguous alias tag "别名"'),
      expect.stringContaining(
        'Skip alias chain for "链路别名" (#4); root target #3 别名 is ambiguous'
      )
    ])
  })

  it('deduplicates and trims aliases', () => {
    expect(normalizeAliases([' 纯爱 ', '纯爱', '', '  '])).toEqual(['纯爱'])
  })

  it('builds merge preview from tag relation counts without relation rows', () => {
    expect(
      getMergePreview(
        {
          id: 1,
          name: '纯爱',
          alias: ['純愛'],
          count: 5,
          _count: { patch_relation: 5 }
        },
        [
          {
            id: 2,
            name: '恋爱',
            alias: ['love'],
            count: 3,
            _count: { patch_relation: 3 }
          }
        ],
        ['恋爱']
      )
    ).toEqual({
      relationCount: 3,
      nextAliases: ['純愛', '恋爱', 'love']
    })
  })
})
