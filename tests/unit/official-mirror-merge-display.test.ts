import { describe, expect, it } from 'vitest'
import {
  blockedReasons,
  defaultStaffId,
  dismissCardConsequence,
  dismissConsequence,
  groupOptions,
  mergeConsequence,
  mergeOutcome,
  reopenConsequence,
  rowBadge,
  signalText,
  sortsForTab,
  survivorSrc,
  userCardSrc
} from '~/components/dashboard/official-mirror/merge/mergeDisplay'
import type {
  MergeListItem,
  MergeOption,
  MergePreview
} from '~/types/api/officialMirror'

const summary = (
  id: number,
  name: string,
  section: 'galgame' | 'patch' = 'galgame'
) => ({
  id,
  name,
  section,
  patchId: 4,
  patchUniqueId: 'abcd1234',
  patchName: '游戏甲',
  publisher: { id: id + 100, name: `发布者${id}` },
  download: id,
  created: '2026-11-01T00:00:00.000Z',
  status: 0
})

const option = (id: number, extra: Partial<MergeOption> = {}): MergeOption => ({
  staff: { ...summary(id, `站方${id}`), hasStaffBackup: true },
  sameSection: true,
  signals: [],
  hits: 0,
  recommended: false,
  highConfidence: false,
  mergeable: true,
  dismissable: true,
  blocks: [],
  record: null,
  ...extra
})

const preview = (extra: Partial<MergePreview> = {}): MergePreview => ({
  classification: 'manual',
  canMerge: true,
  blocks: [],
  basis: 'ab'.repeat(32),
  user: summary(21, '用户卡片'),
  staff: summary(31, '站方卡片'),
  survivorPreview: {
    name: '用户卡片',
    type: ['pc'],
    language: ['zh-Hans'],
    platform: ['windows'],
    note: '',
    noteAppended: true,
    links: [
      {
        id: 2,
        storage: 'touchgal',
        content: 'https://example.com/b',
        size: '3GB',
        version: 1,
        sortOrder: 2,
        changedAt: null,
        backedUpAt: null
      },
      {
        id: 1,
        storage: 'touchgal',
        content: 'https://example.com/a',
        size: '3GB',
        version: 1,
        sortOrder: 1,
        changedAt: null,
        backedUpAt: null
      }
    ]
  },
  fieldComparison: [{ field: '链接数', user: '1', staff: '1' }],
  staffLikeCount: 3,
  exitedPairs: [{ staffResourceId: 41, staffName: '站方41', retained: true }],
  ...extra
})

describe('resource merge workbench display', () => {
  it('writes hits short and misses with both sides through the label maps', () => {
    expect(
      signalText({ signal: 'type', hit: true, user: ['pc'], staff: ['pc'] })
    ).toBe('✓ 类型')
    expect(
      signalText({
        signal: 'type',
        hit: false,
        user: ['pc'],
        staff: ['material']
      })
    ).toBe('✗ 类型：PC游戏 / 资料集')
    expect(
      signalText({
        signal: 'language',
        hit: false,
        user: ['zh-Hans', 'ja'],
        staff: ['ja']
      })
    ).toBe('✗ 语言：简体中文、日本語 / 日本語')
    expect(
      signalText({
        signal: 'platform',
        hit: false,
        user: ['windows'],
        staff: []
      })
    ).toBe('✗ 平台：Windows / —')
    expect(
      signalText({
        signal: 'size',
        hit: false,
        user: ['1.2GB'],
        staff: ['3 GB']
      })
    ).toBe('✗ 大小：1.2GB / 3 GB')
    expect(
      signalText({ signal: 'unique', hit: false, user: ['2'], staff: ['1'] })
    ).toBe('✗ 互为唯一：2 个配对 / 1 个配对')
    expect(
      signalText({
        signal: 'later',
        hit: false,
        user: ['2026-11-01T00:00:00.000Z'],
        staff: ['2026-10-01T00:00:00.000Z']
      })
    ).toBe('✗ 站方发布较晚：2026/11/01 08:00 / 2026/10/01 08:00')
  })

  it('groups options and opens the recommended, then the first mergeable', () => {
    const options = [
      option(31, { recommended: true }),
      option(32),
      option(33, { mergeable: false, sameSection: false })
    ]
    const groups = groupOptions(options)
    expect(groups.recommended.map((item) => item.staff.id)).toEqual([31])
    expect(groups.mergeable.map((item) => item.staff.id)).toEqual([32])
    expect(groups.blocked.map((item) => item.staff.id)).toEqual([33])
    expect(defaultStaffId(options, 'pending')).toBe(31)
    expect(defaultStaffId(options.slice(1), 'pending')).toBe(32)
    expect(defaultStaffId(options.slice(2), 'pending')).toBe(33)
    expect(defaultStaffId([], 'pending')).toBeNull()
    expect(
      defaultStaffId(
        [
          option(31, { recommended: true }),
          option(35, { mergeable: false, record: 'dismissed' })
        ],
        'dismissed'
      )
    ).toBe(35)
    expect(blockedReasons(options[2]!)).toEqual([
      '与用户资源不在同一分区，不能合并'
    ])
    expect(
      blockedReasons(
        option(36, {
          mergeable: false,
          blocks: [{ code: 'staff_case_open', message: '站方卡片有未结事项' }]
        })
      )
    ).toEqual(['站方卡片有未结事项'])
  })

  it('states each dialog consequence with the ids', () => {
    const copy = mergeConsequence(preview())
    expect(copy.consequence).toBe(
      '#31 站方卡片 并入 #21 用户卡片，#31 随后删除。#21 保留名称、属性和发布者，仍在社区资源分组。'
    )
    expect(copy.lines).toEqual(['#41 与 #21 的配对退出，#41 保留。'])
    expect(dismissConsequence(21, 31)).toBe('#21 与 #31 的配对移入已驳回。')
    expect(dismissCardConsequence(21, 3)).toBe(
      '#21 当前的 3 个配对全部移入已驳回。'
    )
    expect(reopenConsequence(21, 31)).toBe('#21 与 #31 的配对回到待处理。')
  })

  it('describes the merge result from the preview', () => {
    const outcome = mergeOutcome(preview())
    expect(outcome.deletion).toBe(
      '#31 站方卡片 删除，指向 #31 的旧链接改为定位到 #21。'
    )
    expect(outcome.composition).toBe(
      '合并后共 2 条链接：原有 1 条在前，移入 1 条在后。'
    )
    expect(outcome.links.map((link) => link.id)).toEqual([1, 2])
    expect(outcome.download).toBe('获取次数合计 52（21 + 31）。')
    expect(outcome.likes).toBe('#31 的 3 个点赞不迁移。')
    expect(outcome.backupWarning).toBe('合并后有 2 条站方备份链接。')
    expect(outcome.exited).toEqual(['#41 站方41 与 #21 的配对退出，#41 保留。'])
    expect(
      mergeOutcome(
        preview({
          survivorPreview: { ...preview().survivorPreview, links: [] },
          staffLikeCount: 0
        })
      ).backupWarning
    ).toBeNull()
  })

  it('shows one badge per pending row', () => {
    const row = {
      pairClass: 'manual',
      recommendState: 'recommended',
      recommendation: { staffResourceId: 31, staffName: '站方' }
    } as MergeListItem
    expect(rowBadge(row).text).toBe('推荐 #31')
    expect(rowBadge({ ...row, pairClass: 'high' }).text).toBe('高置信')
    expect(
      rowBadge({ ...row, recommendState: 'close', recommendation: null }).text
    ).toBe('需人工核对')
    expect(
      rowBadge({ ...row, recommendState: 'none', recommendation: null }).text
    ).toBe('无可合并项')
  })

  it('offers tab-appropriate sorts and builds read-only preview urls', () => {
    expect(sortsForTab('pending')[0]).toBe('download_desc')
    expect(sortsForTab('pending')).not.toContain('handled_desc')
    expect(sortsForTab('merged')[0]).toBe('handled_desc')
    expect(userCardSrc(31)).toBe('/preview/resource-card/31')
    expect(survivorSrc(21, 31)).toBe('/preview/resource-merge?user=21&staff=31')
  })
})
