import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  patch_resource_link_maintenance: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn()
  },
  patch_resource_link_maintenance_event: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
  },
  patch_resource_link_maintenance_participant: {
    createMany: vi.fn(),
    findMany: vi.fn()
  },
  user_message: { create: vi.fn() }
}))
const deps = vi.hoisted(() => ({
  load: vi.fn(),
  verify: vi.fn(),
  cache: vi.fn()
}))
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/case/service', () => ({
  lockCaseUsers: async (_tx: unknown, ids: number[]) => new Set(ids)
}))
vi.mock('~/app/api/patch/resource/_helper', () => ({
  deletePatchResourceCache: deps.cache
}))
vi.mock('~/app/api/patch/resource/link/service', () => ({
  loadHealthTarget: deps.load,
  mutateLinkHealthInternal: deps.verify
}))
vi.mock('~/app/api/patch/resource/maintenance/read', async (original) => ({
  ...(await original<
    typeof import('~/app/api/patch/resource/maintenance/read')
  >()),
  getMaintenanceItem: async () => ({
    health: { maintenance: { revision: controls[0]?.revision ?? 0 } }
  })
}))
import {
  mutateLinkMaintenance,
  recordLinkMaintenanceReport,
  assertLinkMaintenanceFeedbackOpen,
  finishLinkMaintenanceForMutation
} from '~/app/api/patch/resource/maintenance/service'
import type { HealthTargetRow } from '~/app/api/patch/resource/link/service'
type Control = Prisma.patch_resource_link_maintenanceGetPayload<{
  include: {
    events: { include: { _count: { select: { participants: true } } } }
  }
}>
type Event = Control['events'][number]
let controls: Control[] = []
let events: Event[] = []
let participants: { event_id: number; user_id: number }[] = []
const now = new Date('2026-10-19T00:00:00Z')
const row = {
  id: 3,
  version: 1,
  resource_id: 2,
  storage: 'user',
  health: 'ok',
  evidence_round: 0,
  health_changed_at: null,
  resource: { user_id: 7, patch_id: 1, patch: { unique_id: 'SYN00001' } }
} as HealthTargetRow
const tx = db as unknown as Prisma.TransactionClient
const target = { patchId: 1, resourceId: 2, linkId: 3, linkVersion: 1 }
const snapshotControl = () =>
  controls[0]
    ? structuredClone({
        ...controls[0],
        events: events
          .filter((event) => event.control_id === controls[0].id)
          .sort((a, b) => b.round - a.round)
          .slice(0, 1)
      })
    : null
beforeEach(() => {
  vi.resetAllMocks()
  controls = []
  events = []
  participants = []
  deps.load.mockImplementation(async () => row)
  deps.verify.mockResolvedValue({})
  db.$queryRaw.mockResolvedValue([])
  db.$transaction.mockImplementation(async (work) => {
    const before = structuredClone({ controls, events, participants })
    try {
      return await work(db)
    } catch (error) {
      controls = before.controls
      events = before.events
      participants = before.participants
      throw error
    }
  })
  db.patch_resource_link_maintenance.findUnique.mockImplementation(async () =>
    snapshotControl()
  )
  db.patch_resource_link_maintenance.upsert.mockImplementation(
    async ({ create }) => {
      if (!controls.length)
        controls.push({
          id: 1,
          revision: 0,
          latest_round: 0,
          frozen: false,
          stop_note: '',
          stopped_at: null,
          created: now,
          updated: now,
          events: [],
          ...create
        })
      return snapshotControl()
    }
  )
  db.patch_resource_link_maintenance.updateMany.mockImplementation(
    async ({ where, data }) => {
      const control = controls.find(
        (item) => item.id === where.id && item.revision === where.revision
      )
      if (!control) return { count: 0 }
      const { revision, ...fields } = data
      Object.assign(control, fields)
      control.revision += revision.increment
      return { count: 1 }
    }
  )
  db.patch_resource_link_maintenance_event.create.mockImplementation(
    async ({ data }) => {
      const event = {
        id: events.length + 1,
        state: 'pending',
        source: 'report',
        snoozed_until: null,
        publisher_notified_at: null,
        responded_at: null,
        outcome: null,
        note: '',
        result_notified_at: null,
        case_id: null,
        updated: now,
        _count: { participants: 0 },
        ...data
      }
      events.push(event)
      return structuredClone(event)
    }
  )
  db.patch_resource_link_maintenance_event.update.mockImplementation(
    async ({ where, data }) => {
      Object.assign(events.find((event) => event.id === where.id)!, data)
    }
  )
  db.patch_resource_link_maintenance_event.updateMany.mockImplementation(
    async ({ where, data }) => {
      const selected = events.filter(
        (event) =>
          (where.id === undefined || event.id === where.id) &&
          (where.active_key === undefined ||
            event.active_key === where.active_key)
      )
      selected.forEach((event) => Object.assign(event, data))
      return { count: selected.length }
    }
  )
  db.patch_resource_link_maintenance_participant.createMany.mockImplementation(
    async ({ data }) => {
      for (const item of data)
        if (
          !participants.some(
            (person) =>
              person.user_id === item.user_id &&
              person.event_id === item.event_id
          )
        )
          participants.push(item)
    }
  )
  db.patch_resource_link_maintenance_participant.findMany.mockImplementation(
    async ({ where }) =>
      participants.filter((item) => item.event_id === where.event_id)
  )
})
const report = (
  uid = 9,
  kind: 'recorded' | 'renewed' | 'duplicate' = 'recorded',
  weight = 1
) => recordLinkMaintenanceReport(tx, row, { uid, role: 1 }, kind, weight, now)
const action = (data: Record<string, unknown>, date = now) =>
  mutateLinkMaintenance(
    {
      ...target,
      maintenanceRevision: controls[0]?.revision ?? 0,
      ...data
    } as Parameters<typeof mutateLinkMaintenance>[0],
    { uid: 7, role: 2 },
    {},
    date
  )
describe('maintenance atomic event lifecycle', () => {
  it('opens only a positive nonduplicate first report and notifies exactly once in its transaction', async () => {
    expect(await report(9, 'duplicate', 1)).toEqual({
      event: 'none',
      publisherNotified: false
    })
    expect(await report(9, 'recorded', 0)).toEqual({
      event: 'none',
      publisherNotified: false
    })
    expect(controls).toHaveLength(0)
    expect(await report()).toEqual({ event: 'opened', publisherNotified: true })
    expect(await report(10)).toEqual({
      event: 'merged',
      publisherNotified: false
    })
    expect(await report(9, 'duplicate')).toEqual({
      event: 'merged',
      publisherNotified: false
    })
    expect(events).toHaveLength(1)
    expect(participants).toHaveLength(2)
    expect(db.user_message.create).toHaveBeenCalledTimes(1)
    expect(db.user_message.create.mock.calls[0][0].data).toMatchObject({
      recipient_id: 7,
      link: '/workspace/resources/2?linkId=3'
    })
    expect(controls[0]).toMatchObject({ revision: 1, latest_round: 1 })
  })
  it('snoozes in the same round, derives expiry and does not repeat the first notice', async () => {
    await report()
    await action({ action: 'snooze', days: 1 })
    expect(events[0]).toMatchObject({
      round: 1,
      state: 'snoozed',
      snoozed_until: new Date(now.getTime() + 86400000)
    })
    await expect(
      assertLinkMaintenanceFeedbackOpen(
        tx,
        row,
        new Date(now.getTime() + 86400000 - 1)
      )
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      assertLinkMaintenanceFeedbackOpen(
        tx,
        row,
        new Date(now.getTime() + 86400000)
      )
    ).resolves.toBeUndefined()
    expect(events).toHaveLength(1)
    expect(db.user_message.create).toHaveBeenCalledTimes(1)
  })
  it('responds with one safe public result per valid participant and rejects replay', async () => {
    await report()
    await report(10)
    await report(11, 'recorded', 0)
    const result = await action({ action: 'respond', note: '请按说明获取' })
    expect(result.notifiedCount).toBe(2)
    expect(events[0]).toMatchObject({
      state: 'handled',
      outcome: 'explained',
      active_key: null,
      note: '请按说明获取'
    })
    expect(deps.verify).not.toHaveBeenCalled()
    await expect(
      action({ action: 'respond', note: '重复' })
    ).rejects.toMatchObject({ status: 409 })
    expect(
      db.user_message.create.mock.calls.slice(1).map(([args]) => args.data.link)
    ).toEqual([
      '/SYN00001?tab=resources#resource-2',
      '/SYN00001?tab=resources#resource-2'
    ])
  })
  it('freezes without inventing an optional event, resumes without chasing old reports, and opens a later new round', async () => {
    await action({ action: 'stop', note: '不再维护此地址' })
    expect(events).toHaveLength(0)
    expect(db.user_message.create).not.toHaveBeenCalled()
    await expect(
      assertLinkMaintenanceFeedbackOpen(tx, row, now)
    ).rejects.toMatchObject({ status: 409 })
    await action({ action: 'resume' })
    await report()
    await action({ action: 'stop', note: '停止' })
    await action({ action: 'resume' })
    expect(await report(10, 'duplicate')).toEqual({
      event: 'none',
      publisherNotified: false
    })
    await report(10)
    expect(events.map((event) => [event.round, event.state])).toEqual([
      [1, 'handled'],
      [2, 'pending']
    ])
  })
  it('rolls back maintenance when the existing health verify rejects and coalesces its successful notifications', async () => {
    await report()
    const basis = {
      ...target,
      health: 'broken',
      evidenceRound: 1,
      healthChangedAt: now.toISOString()
    }
    deps.verify.mockRejectedValueOnce(new Error('cooldown'))
    await expect(
      action({ action: 'verify', note: '已核实', basis })
    ).rejects.toThrow('cooldown')
    expect(events[0].state).toBe('pending')
    await action({ action: 'verify', note: '已核实', basis })
    expect(deps.verify.mock.calls.at(-1)?.[5]).toEqual([9])
    expect(events[0]).toMatchObject({ state: 'handled', outcome: 'verified' })
  })
  it('checks identity and revision before writes, and never lets ordinary publishers maintain touchgal', async () => {
    await report()
    await expect(
      mutateLinkMaintenance(
        { ...target, maintenanceRevision: 0, action: 'stop', note: 'x' },
        { uid: 7, role: 2 }
      )
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      mutateLinkMaintenance(
        { ...target, maintenanceRevision: 1, action: 'stop', note: 'x' },
        { uid: 8, role: 4 }
      )
    ).rejects.toMatchObject({ status: 403 })
    deps.load.mockResolvedValue({ ...row, storage: 'touchgal' })
    await expect(action({ action: 'stop', note: 'x' })).rejects.toMatchObject({
      status: 403
    })
  })
  it('completes old-version pending events on relink while preserving the control history', async () => {
    await report()
    await finishLinkMaintenanceForMutation(tx, {
      links: [{ id: 3, version: 1 }],
      resourceId: 2,
      uniqueId: 'SYN00001',
      outcome: 'relinked',
      actorId: 7,
      now
    })
    expect(events[0]).toMatchObject({
      state: 'handled',
      outcome: 'relinked',
      round: 1
    })
    expect(controls[0]).toMatchObject({
      original_link_id: 3,
      link_version: 1,
      latest_round: 1
    })
  })
})
