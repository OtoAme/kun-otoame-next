import { describe, expect, it } from 'vitest'
import { getVisibleDashboardNav } from '~/constants/dashboard'
import {
  batchReportLines,
  batchRequestPairs,
  confirmPairContent
} from '~/components/dashboard/official-mirror/mergeConfirmation'
import { cacheRefreshBody } from '~/components/dashboard/official-mirror/cacheRefresh'
import { shouldApplyPreview } from '~/components/dashboard/official-mirror/contract'
import {
  decideResolvedRedirect,
  parseResolvedResource
} from '~/components/patch/resource/mergedResourceLocation'
import {
  formatBackupDate,
  readAuxiliaryClick
} from '~/components/patch/resource/publicMirrorFacts'
import { partitionByPublisherRole } from '~/components/patch/resource/resourceGrouping'
import type { MergeBatchResult } from '~/types/api/officialMirror'

const navIds = (role: number) =>
  getVisibleDashboardNav(role).flatMap((group) =>
    group.items.map((item) => item.id)
  )

describe('official mirror pages', () => {
  it('shows backup and merge only from role 3', () => {
    expect(navIds(3)).toEqual(
      expect.arrayContaining(['backup', 'resource-merges'])
    )
    expect(navIds(2)).not.toContain('backup')
    expect(navIds(2)).not.toContain('resource-merges')
    const content = getVisibleDashboardNav(3).find(
      (group) => group.label === '内容'
    )
    const ids = content?.items.map((item) => item.id) ?? []
    expect(ids.indexOf('backup')).toBeGreaterThan(ids.indexOf('company-merges'))
    expect(ids.indexOf('resource-merges')).toBeGreaterThan(ids.indexOf('backup'))
  })

  it('keeps official and community groups on the author role', () => {
    const grouped = partitionByPublisherRole([
      { id: 1, user: { role: 3 } },
      { id: 2, user: { role: 1 } },
      { id: 3, user: { role: 4 } },
      { id: 4 }
    ])
    expect(grouped.official.map((item) => item.id)).toEqual([1, 3])
    expect(grouped.community.map((item) => item.id)).toEqual([2, 4])
  })

  it('redirects once with the current patch id and drops a late response', () => {
    const location = parseResolvedResource({
      resourceId: 9,
      patchId: 3,
      patchUniqueId: 'abcd1234',
      section: 'galgame'
    })
    expect(
      decideResolvedRedirect({
        location,
        requestGeneration: 2,
        currentGeneration: 2,
        attemptedDestinationIds: new Set(),
        currentHref: '/old?tab=resources&resourceId=4'
      })?.href
    ).toBe('/abcd1234?tab=resources&resourceSection=galgame&resourceId=9')
    expect(
      decideResolvedRedirect({
        location,
        requestGeneration: 1,
        currentGeneration: 2,
        attemptedDestinationIds: new Set(),
        currentHref: '/old'
      })
    ).toBeNull()
    expect(
      parseResolvedResource({
        resourceId: 9,
        patchId: 3,
        patchUniqueId: 'short',
        section: 'galgame'
      })
    ).toBeNull()
    expect(
      decideResolvedRedirect({
        location,
        requestGeneration: 2,
        currentGeneration: 2,
        attemptedDestinationIds: new Set([9]),
        currentHref: '/old'
      })
    ).toBeNull()
  })

  it('does not confirm content from selection or a stale preview', () => {
    const fields = {
      patchUniqueId: 'abcd1234',
      authorId: 7
    }
    expect(
      confirmPairContent({
        checked: false,
        canMerge: true,
        basis: 'a'.repeat(64),
        userResourceId: 1,
        staffResourceId: 2,
        pairClass: 'high',
        ...fields
      })
    ).toBeNull()
    const manual = confirmPairContent({
      checked: true,
      canMerge: true,
      basis: 'ab'.repeat(32),
      userResourceId: 1,
      staffResourceId: 2,
      pairClass: 'manual',
      ...fields
    })
    const pair = confirmPairContent({
      checked: true,
      canMerge: true,
      basis: 'ab'.repeat(32),
      userResourceId: 3,
      staffResourceId: 4,
      pairClass: 'high',
      ...fields
    })
    expect(pair?.contentConfirmed).toBe(true)
    expect(batchRequestPairs([])).toBeNull()
    expect(batchRequestPairs(manual ? [manual] : [])).toBeNull()
    expect(batchRequestPairs([...(manual ? [manual] : []), ...(pair ? [pair] : [])])).toEqual([
      {
        userResourceId: 3,
        staffResourceId: 4,
        basis: 'ab'.repeat(32),
        contentConfirmed: true
      }
    ])
    expect(
      shouldApplyPreview(
        { seq: 1, userResourceId: 1, staffResourceId: 2 },
        { seq: 2, userResourceId: 1, staffResourceId: 2 }
      )
    ).toBe(false)
  })

  it('reports outcomes and remaining without treating a skip as a stop', () => {
    const result: MergeBatchResult = {
      outcomes: [
        {
          userResourceId: 1,
          staffResourceId: 2,
          status: 'skipped',
          reason: '内容未确认'
        },
        {
          userResourceId: 3,
          staffResourceId: 4,
          status: 'merged',
          result: {
            alreadyMerged: false,
            userResourceId: 3,
            staffResourceId: 4,
            resourceId: 3,
            patchId: 8,
            patchUniqueId: 'abcd1234',
            section: 'galgame',
            movedLinkIds: [9],
            noteAppended: false,
            cacheRefreshed: true
          }
        }
      ],
      remaining: [{ userResourceId: 5, staffResourceId: 6 }]
    }
    expect(batchReportLines(result)).toEqual([
      '#1 / #2 未合并：内容未确认',
      '#3 / #4 已合并，保留 #3',
      '#5 / #6 未开始'
    ])
  })

  it('drops an invalid backup date and a missing auxiliary click', () => {
    expect(formatBackupDate('not-a-date')).toBeNull()
    expect(readAuxiliaryClick({})).toBeNull()
    expect(readAuxiliaryClick({ click: 0 })).toBe(0)
  })

  it('builds a cache refresh only from a real page id and known authors', () => {
    expect(cacheRefreshBody({ patchUniqueId: 'short', authorId: 7 })).toBeNull()
    expect(
      cacheRefreshBody({
        patchUniqueId: 'abcd1234',
        authorIds: [7, 0, 7, 8]
      })
    ).toEqual({ uniqueIds: ['abcd1234'], authorIds: [7, 8] })
  })
})
