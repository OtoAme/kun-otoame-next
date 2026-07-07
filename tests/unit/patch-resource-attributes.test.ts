import { describe, expect, test } from 'vitest'
import { GalgameCardSelectField } from '~/constants/api/select'
import {
  PUBLISHED_PATCH_RESOURCE_STATUS,
  buildPatchResourceAttributes,
  createVisiblePatchResourceWhere,
  visiblePatchResourceCountSelect
} from '~/utils/patchResourceAttributes'

describe('patch resource attributes', () => {
  test('builds deduplicated attributes from visible resources', () => {
    const attrs = buildPatchResourceAttributes([
      {
        type: ['pc', 'mobile'],
        language: ['zh-Hans'],
        platform: ['windows']
      },
      {
        type: ['pc'],
        language: ['zh-Hans', 'ja'],
        platform: ['windows', 'android']
      }
    ])

    expect(attrs).toEqual({
      type: ['pc', 'mobile'],
      language: ['zh-Hans', 'ja'],
      platform: ['windows', 'android']
    })
  })

  test('forces visible resource queries to published resources', () => {
    expect(createVisiblePatchResourceWhere({ patch_id: 10, status: 2 })).toEqual(
      {
        patch_id: 10,
        status: PUBLISHED_PATCH_RESOURCE_STATUS
      }
    )
  })

  test('galgame cards count only published resources', () => {
    expect(GalgameCardSelectField._count.select.resource).toEqual(
      visiblePatchResourceCountSelect
    )
  })
})
