import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  due: vi.fn(),
  lock: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  set: vi.fn()
}))
vi.mock('~/prisma/index', () => ({
  prisma: { patch_resource_link: { findMany: mocks.findMany } }
}))
vi.mock('~/app/api/patch/resource/link/service', () => ({
  runDueLinkHealth: mocks.due
}))
vi.mock('~/server/tasks/withTaskLock', () => ({ withTaskLock: mocks.lock }))
vi.mock('node-cron', () => ({ default: { createTask: mocks.create } }))
vi.mock('~/lib/redis', () => ({ getKv: mocks.get, setKv: mocks.set }))
import { runLinkHealthTask } from '~/server/tasks/linkHealthTask'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.findMany.mockResolvedValue([])
  mocks.due.mockResolvedValue({ changed: false })
  mocks.get.mockResolvedValue('0')
})
it('advances beyond a full permanent skipped prefix on the next bounded invocation', async () => {
  let cursor = 0
  mocks.get.mockImplementation(async () => String(cursor))
  mocks.set.mockImplementation(async (_key, value) => {
    cursor = Number(value)
  })
  mocks.findMany.mockImplementation(async ({ where }) =>
    Array.from(
      { length: where.id.gt < 2000 ? 200 : where.id.gt === 2000 ? 1 : 0 },
      (_, i) => ({
        id: where.id.gt + i + 1,
        version: 1,
        evidence_round: 1,
        health: 'disputed',
        health_changed_at: new Date(),
        resource_id: 1,
        resource: { patch_id: 1 }
      })
    )
  )
  mocks.due.mockImplementation(async (basis) => ({
    changed: basis.linkId === 2001
  }))
  expect(await runLinkHealthTask()).toEqual({ changed: 0 })
  expect(cursor).toBe(2000)
  expect(await runLinkHealthTask()).toEqual({ changed: 1 })
  expect(mocks.due).toHaveBeenCalledWith(
    expect.objectContaining({ linkId: 2001 }),
    expect.any(Date)
  )
})
it('captures exact due basis and bounds scanning with an ID cursor so skipped conflicts cannot spin', async () => {
  const clock = new Date('2026-10-09T00:00:00Z')
  mocks.findMany.mockResolvedValueOnce([
    {
      id: 8,
      version: 2,
      evidence_round: 4,
      health: 'disputed',
      health_changed_at: clock,
      resource_id: 3,
      resource: { patch_id: 1 }
    }
  ])
  expect(await runLinkHealthTask(clock)).toEqual({ changed: 0 })
  expect(mocks.due).toHaveBeenCalledWith(
    {
      patchId: 1,
      resourceId: 3,
      linkId: 8,
      linkVersion: 2,
      evidenceRound: 4,
      health: 'disputed',
      healthChangedAt: clock.toISOString()
    },
    clock
  )
  expect(mocks.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 200, orderBy: { id: 'asc' } })
  )
})
