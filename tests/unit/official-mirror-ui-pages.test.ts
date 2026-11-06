import { describe, expect, it } from 'vitest'
import { getVisibleDashboardNav } from '~/constants/dashboard'
import {
  acceptBatchListItems,
  batchLineStatusText,
  batchRequestPairs,
  batchResultLines,
  confirmPairContent,
  itemsAfterBatch,
  type BatchListItem
} from '~/components/dashboard/official-mirror/mergeConfirmation'
import { cacheRefreshBody } from '~/components/dashboard/official-mirror/cacheRefresh'
import {
  acceptDismissCardResult,
  acceptMergeOptions,
  acceptMergePreview,
  mergeListCounts,
  shouldApplyPreview
} from '~/components/dashboard/official-mirror/contract'
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
    expect(ids.indexOf('resource-merges')).toBeGreaterThan(
      ids.indexOf('backup')
    )
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
    expect(
      batchRequestPairs([...(manual ? [manual] : []), ...(pair ? [pair] : [])])
    ).toEqual([
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

  const listItem = (u: number, s: number, extra: Partial<BatchListItem> = {}) =>
    ({
      userResourceId: u,
      staffResourceId: s,
      basis: 'ab'.repeat(32),
      contentConfirmed: true,
      pairClass: 'high',
      patchUniqueId: 'abcd1234',
      authorId: 7,
      staffAuthorId: 8,
      userName: `用户${u}`,
      staffName: `站方${s}`,
      patchName: '游戏',
      section: 'galgame',
      ...extra
    }) as BatchListItem

  it('reports outcomes by name and keeps only pairs that did not start', () => {
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
        },
        {
          userResourceId: 7,
          staffResourceId: 8,
          status: 'failed',
          reason: '数据库繁忙'
        }
      ],
      remaining: [{ userResourceId: 5, staffResourceId: 6 }]
    }
    const sent = [
      listItem(1, 2),
      listItem(3, 4),
      listItem(7, 8),
      listItem(5, 6),
      listItem(9, 10)
    ]
    const lines = batchResultLines(sent, result)
    expect(
      lines.map((line) => [
        line.userName,
        line.staffName,
        batchLineStatusText(line)
      ])
    ).toEqual([
      ['用户1', '站方2', '已跳过：内容未确认'],
      ['用户3', '站方4', '已合并'],
      ['用户7', '站方8', '失败：数据库繁忙'],
      ['用户5', '站方6', '未开始'],
      ['用户9', '站方10', '没有返回结果']
    ])
    expect(lines[1]?.authorIds).toEqual([7, 8])
    const added = listItem(11, 12)
    expect(
      itemsAfterBatch([...sent, added], lines).map(
        (item) => item.userResourceId
      )
    ).toEqual([5, 9, 11])
  })

  it('reads back only complete confirmed high pairs from storage', () => {
    const good = listItem(1, 2)
    expect(
      acceptBatchListItems([
        good,
        { ...good, staffResourceId: 3 },
        listItem(4, 5, { pairClass: 'manual' }),
        { ...listItem(6, 7), contentConfirmed: false },
        listItem(8, 9, { basis: 'short' }),
        listItem(10, 11, { section: 'other' as never }),
        'junk'
      ]).map((item) => [item.userResourceId, item.staffResourceId])
    ).toEqual([[1, 2]])
    expect(acceptBatchListItems('nope')).toEqual([])
    expect(
      acceptBatchListItems(
        Array.from({ length: 60 }, (_, index) =>
          listItem(index + 1, 100 + index)
        )
      )
    ).toHaveLength(50)
  })

  it('accepts only the options, preview and counts of the requested target', () => {
    expect(
      mergeListCounts({ counts: { pending: 2, dismissed: 1, merged: 0 } })
    ).toEqual({
      pending: 2,
      dismissed: 1,
      merged: 0
    })
    expect(mergeListCounts({ counts: { pending: 2 } })).toBeNull()
    expect(mergeListCounts(null)).toBeNull()
    const options = {
      user: { id: 5 },
      recommendState: 'none',
      options: [{ staff: { id: 6 }, signals: [], blocks: [] }],
      history: []
    }
    expect(acceptMergeOptions(options, 5)).not.toBeNull()
    expect(acceptMergeOptions(options, 4)).toBeNull()
    expect(acceptMergeOptions({ ...options, options: [{}] }, 5)).toBeNull()
    const preview = {
      user: { id: 5 },
      staff: { id: 6 },
      basis: 'ab'.repeat(32),
      canMerge: true,
      blocks: [],
      exitedPairs: [],
      fieldComparison: [],
      linkSummary: { user: [], staff: [] },
      survivorPreview: { links: [] }
    }
    expect(
      acceptMergePreview(preview, { userResourceId: 5, staffResourceId: 6 })
    ).not.toBeNull()
    expect(
      acceptMergePreview(preview, { userResourceId: 5, staffResourceId: 7 })
    ).toBeNull()
    expect(
      acceptDismissCardResult({
        changed: true,
        dismissed: [1],
        unchanged: [],
        skipped: []
      })
    ).not.toBeNull()
    expect(acceptDismissCardResult({ changed: true })).toBeNull()
  })

  it('requires complete and unambiguous original link summaries before accepting a merge preview', () => {
    const pair = { userResourceId: 5, staffResourceId: 6 }
    const userLink = { id: 11, storage: 'user', size: '1 GB' }
    const staffLink = { id: 12, storage: 'touchgal', size: '2 GB' }
    const preview = {
      user: { id: 5 },
      staff: { id: 6 },
      basis: 'ab'.repeat(32),
      canMerge: true,
      blocks: [],
      exitedPairs: [],
      fieldComparison: [{ field: '链接数', user: '1', staff: '1' }],
      linkSummary: { user: [userLink], staff: [staffLink] },
      survivorPreview: { links: [userLink, staffLink] }
    }
    expect(acceptMergePreview(preview, pair)).not.toBeNull()
    for (const change of [
      { linkSummary: undefined },
      { linkSummary: { user: [userLink] } },
      { linkSummary: { user: [userLink], staff: [userLink] } },
      { linkSummary: { user: [], staff: [staffLink] } },
      {
        linkSummary: {
          user: [{ ...userLink, size: 1 }],
          staff: [staffLink]
        }
      },
      { survivorPreview: { links: [userLink, userLink] } },
      { survivorPreview: { links: [userLink, { ...staffLink, id: 13 }] } },
      { fieldComparison: [{ field: '链接数', user: 1, staff: '1' }] }
    ]) {
      expect(acceptMergePreview({ ...preview, ...change }, pair)).toBeNull()
    }
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
