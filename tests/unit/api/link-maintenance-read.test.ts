import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  patch_resource_link: { findFirst: vi.fn() },
  patch_resource_link_maintenance: { findUnique: vi.fn() },
  ops_case: { findFirst: vi.fn() }
}))
const canRead = vi.hoisted(() => vi.fn())
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/case/service', () => ({ canReadCaseForViewer: canRead }))
import {
  getWorkspaceMaintenance,
  getMaintenanceItem,
  representedPublisherLinkCaseIds
} from '~/app/api/patch/resource/maintenance/read'
const now = new Date('2026-10-19T00:00:00Z')
const user = { id: 7, role: 2, name: 'user' }
const target = { patchId: 1, resourceId: 2, linkId: 3, linkVersion: 1 }
const row = {
  id: 3,
  version: 1,
  resource_id: 2,
  storage: 'user',
  size: '1 GB',
  content: 'https://example.test/synthetic',
  code: '',
  password: '',
  hash: '',
  sort_order: 0,
  download: 0,
  health: 'ok',
  evidence_round: 0,
  health_changed_at: null,
  verified_at: null,
  content_changed_at: null,
  check: null,
  reports: [],
  maintenance_controls: [],
  resource: {
    user_id: 7,
    patch_id: 1,
    name: 'resource',
    section: 'galgame',
    patch: { unique_id: 'SYN00001', name: 'game' }
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  canRead.mockResolvedValue(true)
  db.patch_resource_link.findFirst.mockResolvedValue(row)
  db.patch_resource_link_maintenance.findUnique.mockResolvedValue({
    revision: 2,
    frozen: false,
    stopped_at: null,
    events: [
      {
        id: 4,
        round: 1,
        state: 'pending',
        snoozed_until: null,
        case_id: null,
        created: now,
        responded_at: null,
        outcome: null,
        _count: { participants: 2 }
      }
    ]
  })
})
describe('private maintenance database scope', () => {
  it('includes a related case only after the shared read matrix authorizes it', async () => {
    const control = await db.patch_resource_link_maintenance.findUnique()
    control.events[0].case_id = 8
    db.patch_resource_link_maintenance.findUnique.mockResolvedValue(control)
    expect(
      (
        await getMaintenanceItem(
          target,
          user,
          db as unknown as Prisma.TransactionClient,
          now
        )
      ).caseId
    ).toBe(8)
    expect(canRead).toHaveBeenCalledWith(db, 8, 7, 2)
    canRead.mockResolvedValue(false)
    expect(
      (
        await getMaintenanceItem(
          target,
          user,
          db as unknown as Prisma.TransactionClient,
          now
        )
      ).caseId
    ).toBeNull()
  })
  it('returns pending feedback even when health is normal, with no credentials or participant identities', async () => {
    const item = await getMaintenanceItem(
      target,
      user,
      db as unknown as Prisma.TransactionClient,
      now
    )
    expect(item).toMatchObject({
      state: 'pending',
      health: { health: 'ok' },
      reportCount: 2,
      maintenanceRevision: 2,
      caseId: null
    })
    expect(
      db.patch_resource_link.findFirst.mock.calls[0][0].where.resource.user_id
    ).toBe(7)
    expect(JSON.stringify(item)).not.toContain('example.test')
    expect(item).not.toHaveProperty('participants')
  })
  it('filters before count/page and uses an independent actionable predicate that includes expired snoozes', async () => {
    db.$queryRaw.mockImplementation(async (query) =>
      query.sql.includes('SELECT l.id AS') ? [target] : [{ count: 1n }]
    )
    const result = await getWorkspaceMaintenance(
      {
        view: 'feedback',
        page: 2,
        limit: 20,
        query: 'game',
        section: 'galgame'
      },
      user,
      db as unknown as Prisma.TransactionClient,
      now
    )
    expect(result).toMatchObject({ total: 1, actionableCount: 1, page: 2 })
    const queries = db.$queryRaw.mock.calls.map(([query]) => query)
    expect(queries[0].sql).toContain('e.active_key IS NOT NULL')
    expect(queries[0].sql).not.toContain("l.health<>'ok'")
    expect(queries[0].values).toEqual(
      expect.arrayContaining([7, 'galgame', '%game%', 20])
    )
    expect(queries[2].sql).toContain("e.state='snoozed' AND e.snoozed_until<=")
  })
  it('does not suppress corrupt latest or unmatched historical cases', async () => {
    const fact = {
      id: 8,
      link_id: 3,
      link_version: 1,
      resource_id: 2,
      patch_id: 1,
      health: 'suspect',
      evidence_round: 2,
      health_changed_at: now,
      context: {
        ...target,
        health: 'suspect',
        evidenceRound: 2,
        healthChangedAt: now.toISOString(),
        source: 'user_reports'
      }
    }
    db.$queryRaw.mockResolvedValue([
      fact,
      { ...fact, id: 9, context: { broken: true } },
      { ...fact, id: 10, link_version: 2 }
    ])
    expect(await representedPublisherLinkCaseIds(7, db)).toEqual([8])
    expect(db.$queryRaw.mock.calls[0][0].sql).toContain(
      'ORDER BY created DESC,id DESC LIMIT 1'
    )
  })
})
