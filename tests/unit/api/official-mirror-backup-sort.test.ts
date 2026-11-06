import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backupListSchema } from '~/validations/officialMirror'
import { listBackupQueue } from '~/lib/officialMirror/backupService'
import type { BackupTab } from '~/types/api/officialMirror'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('~/prisma/index', () => ({ prisma: { $queryRaw: mocks.query } }))
vi.mock('~/app/api/patch/resource/mutation', () => ({
  runResourceMutation: vi.fn()
}))
vi.mock('~/lib/officialMirror/cache', () => ({
  refreshAfterCommit: vi.fn()
}))

const cards = [
  { id: 11, created: new Date('2026-01-03T00:00:00Z'), download: 10 },
  { id: 12, created: new Date('2026-01-01T00:00:00Z'), download: 30 },
  { id: 13, created: new Date('2026-01-02T00:00:00Z'), download: 30 },
  { id: 14, created: new Date('2026-01-02T00:00:00Z'), download: 20 }
].map((card) => ({
  ...card,
  name: `排序测试 ${card.id}`,
  section: 'galgame',
  patch_id: 10,
  user_id: 2,
  status: 0,
  note: '',
  type: ['PC游戏'],
  language: ['简体中文'],
  platform: ['Windows'],
  publisher_left_at: null,
  updated: new Date('2026-02-03T00:00:00Z'),
  publisher_name: '排序测试发布者',
  role: 1,
  patch_name: '排序测试游戏',
  patch_unique_id: 'abcd1234',
  patch_status: 0
}))

const seed = (tab: BackupTab) => {
  const links = cards.flatMap((card) => {
    const external = {
      id: card.id * 10,
      resource_id: card.id,
      storage: 'user',
      content: '',
      size: '',
      version: 1,
      sort_order: 0,
      attached_at: new Date('2026-02-02T00:00:00Z'),
      content_changed_at: null
    }
    return tab === 'rebackup'
      ? [
          external,
          {
            ...external,
            id: external.id + 1,
            storage: 'touchgal',
            sort_order: 1,
            attached_at: new Date('2026-02-01T00:00:00Z')
          }
        ]
      : [external]
  })
  mocks.query.mockImplementation(async (query: { sql: string }) => {
    if (query.sql.includes('FROM patch_resource r')) return cards
    if (query.sql.includes('FROM patch_resource_link l')) return links
    if (query.sql.includes('FROM patch_resource_backup_state')) {
      return tab === 'ignored'
        ? cards.map((card) => ({
            resource_id: card.id,
            ignored_at: new Date('2026-02-03T00:00:00Z')
          }))
        : []
    }
    throw new Error('Unexpected backup queue query')
  })
}

const orders = [
  { sort: 'download_desc', expected: [12, 13, 14, 11] },
  { sort: 'download_asc', expected: [11, 14, 12, 13] },
  { sort: 'created_desc', expected: [11, 13, 14, 12] },
  { sort: 'created_asc', expected: [12, 13, 14, 11] }
] as const

beforeEach(() => vi.clearAllMocks())

describe('backup queue sorting', () => {
  it('keeps the default order and rejects unknown sorts', () => {
    expect(backupListSchema.parse({ tab: 'unbacked' }).sort).toBe(
      'download_desc'
    )
    expect(
      backupListSchema.safeParse({ tab: 'unbacked', sort: 'unknown' }).success
    ).toBe(false)
  })

  describe.each<BackupTab>(['unbacked', 'rebackup', 'ignored'])('%s', (tab) => {
    it.each(orders)(
      'orders the full queue by $sort before pagination',
      async ({ sort, expected }) => {
        seed(tab)
        const input = backupListSchema.parse({ tab, sort, limit: 2 })
        const first = await listBackupQueue(input)
        const second = await listBackupQueue({ ...input, page: 2 })
        expect([
          ...first.items.map((item) => item.resourceId),
          ...second.items.map((item) => item.resourceId)
        ]).toEqual(expected)
        expect(first.total).toBe(4)
        expect(second.total).toBe(4)
        expect(first.counts).toEqual({
          unbacked: 0,
          rebackup: 0,
          ignored: 0,
          [tab]: 4
        })
        expect(second.counts).toEqual(first.counts)
      }
    )
  })
})
