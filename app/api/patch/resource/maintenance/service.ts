import { Prisma } from '@prisma/client'
import { LINK_MAINTENANCE_ERRORS as E } from '~/constants/linkMaintenance'
import {
  ResourceMutationError,
  resourcePostCommit,
  runResourceMutation
} from '../mutation'
import { deletePatchResourceCache } from '../_helper'
import { createMessage } from '~/app/api/utils/message'
import { workspaceResourceHref } from '~/utils/workspaceRoutes'
import { canManageResourceLink } from '~/components/patch/resource/resourcePermissions'
import type { HealthActor, HealthTargetRow } from '../link/service'
import {
  getMaintenanceControl,
  getMaintenanceItem,
  maintenanceInclude
} from './read'
import { assertMaintenanceFeedback, maintenanceState } from './policy'
import { linkMaintenanceActionSchema } from '~/validations/linkMaintenance'
import type { LinkTarget } from '~/types/api/linkHealth'
import type {
  LinkMaintenanceActionInput,
  LinkMaintenanceActionResponse,
  LinkMaintenanceOutcome,
  LinkMaintenanceReportReceipt
} from '~/types/api/linkMaintenance'

type Tx = Prisma.TransactionClient
type Control = NonNullable<Awaited<ReturnType<typeof getMaintenanceControl>>>
const lockCaseUsers = async (tx: Tx, ids: number[]) =>
  (await import('~/app/api/case/service')).lockCaseUsers(tx, ids)
const fail: (code: keyof typeof E) => never = (code) => {
  throw new ResourceMutationError(E[code].message, E[code].status)
}
const targetOf = (row: HealthTargetRow): LinkTarget => ({
  patchId: row.resource.patch_id,
  resourceId: row.resource_id,
  linkId: row.id,
  linkVersion: row.version
})
const activeEvent = (control: Control | null) =>
  control?.events.find((event) => event.active_key !== null)
const advance = async (
  tx: Tx,
  control: Control,
  data: Prisma.patch_resource_link_maintenanceUpdateManyMutationInput = {}
) => {
  if (control.revision >= 2147483647) fail('state_conflict')
  const changed = await tx.patch_resource_link_maintenance.updateMany({
    where: { id: control.id, revision: control.revision },
    data: { ...data, revision: { increment: 1 } }
  })
  if (changed.count !== 1) fail('state_conflict')
}
const ensureControl = async (tx: Tx, row: HealthTargetRow) =>
  tx.patch_resource_link_maintenance.upsert({
    where: {
      original_link_id_link_version: {
        original_link_id: row.id,
        link_version: row.version
      }
    },
    create: {
      original_link_id: row.id,
      link_id: row.id,
      link_version: row.version,
      resource_id: row.resource_id,
      patch_id: row.resource.patch_id,
      owner_id: row.resource.user_id
    },
    update: {},
    include: maintenanceInclude
  })

/** Caller already owns the actual link lock. No parent resource lock is taken. */
export const assertLinkMaintenanceFeedbackOpen = async (
  db: Pick<Tx, 'patch_resource_link_maintenance'>,
  row: Pick<HealthTargetRow, 'id' | 'version'>,
  now: Date
) =>
  assertMaintenanceFeedback(
    await getMaintenanceControl(db, row.id, row.version),
    now
  )

export const recordLinkMaintenanceReport = async (
  tx: Tx,
  row: HealthTargetRow,
  actor: HealthActor,
  report: 'recorded' | 'renewed' | 'duplicate',
  weight: number,
  now: Date
): Promise<LinkMaintenanceReportReceipt> => {
  if (row.storage === 'touchgal')
    return { event: 'none', publisherNotified: false }
  let control = await getMaintenanceControl(tx, row.id, row.version)
  assertMaintenanceFeedback(control, now)
  let event = activeEvent(control)
  const opens = !event && report !== 'duplicate' && weight > 0
  if (!event && !opens) return { event: 'none', publisherNotified: false }
  if (opens) {
    control = await ensureControl(tx, row)
    if (control.latest_round >= 2147483647) fail('state_conflict')
    await advance(tx, control, { latest_round: control.latest_round + 1 })
    event = await tx.patch_resource_link_maintenance_event.create({
      data: {
        control_id: control.id,
        round: control.latest_round + 1,
        active_key: `maintenance:${control.id}`,
        state: 'pending',
        source: 'report',
        created: now
      },
      include: { _count: { select: { participants: true } } }
    })
  }
  if (!event) fail('state_conflict')
  const accountIds = [actor.uid, ...(opens ? [row.resource.user_id] : [])]
  const accounts = await lockCaseUsers(tx, accountIds)
  if (weight > 0 && accounts.has(actor.uid))
    await tx.patch_resource_link_maintenance_participant.createMany({
      data: [{ event_id: event.id, user_id: actor.uid, created: now }],
      skipDuplicates: true
    })
  let notified = false
  if (
    opens &&
    actor.uid !== row.resource.user_id &&
    accounts.has(row.resource.user_id)
  ) {
    await createMessage(
      {
        type: 'system',
        recipient_id: row.resource.user_id,
        content: '您发布的资源链接收到失效反馈，请在工作台回应。',
        link: workspaceResourceHref(row.resource_id, row.id)
      },
      tx
    )
    await tx.patch_resource_link_maintenance_event.update({
      where: { id: event.id },
      data: { publisher_notified_at: now }
    })
    notified = true
  }
  return { event: opens ? 'opened' : 'merged', publisherNotified: notified }
}

export const attachMaintenanceCase = async (
  tx: Tx,
  row: HealthTargetRow,
  caseId: number | null
) => {
  if (!caseId || row.storage === 'touchgal') return
  const control = await getMaintenanceControl(tx, row.id, row.version)
  const event = activeEvent(control)
  if (event && event.case_id !== caseId)
    await tx.patch_resource_link_maintenance_event.update({
      where: { id: event.id },
      data: { case_id: caseId }
    })
}

const finishEvent = async (
  tx: Tx,
  control: Control,
  outcome: LinkMaintenanceOutcome,
  note: string,
  now: Date
) => {
  const event = activeEvent(control)
  if (!event) return []
  const won = await tx.patch_resource_link_maintenance_event.updateMany({
    where: {
      id: event.id,
      active_key: event.active_key,
      state: { in: ['pending', 'snoozed'] }
    },
    data: {
      active_key: null,
      state: 'handled',
      outcome,
      note,
      responded_at: now,
      snoozed_until: null
    }
  })
  if (won.count !== 1) fail('state_conflict')
  const people = await tx.patch_resource_link_maintenance_participant.findMany({
    where: { event_id: event.id },
    select: { user_id: true }
  })
  return people.map((person) => person.user_id)
}
const notifyResults = async (
  tx: Tx,
  ids: number[],
  actorId: number,
  uniqueId: string,
  resourceId: number,
  outcome: LinkMaintenanceOutcome,
  note: string
) => {
  const recipients = [...new Set(ids)].filter((id) => id !== actorId)
  if (!recipients.length) return []
  const accounts = await lockCaseUsers(tx, recipients)
  const existing = recipients.filter((id) => accounts.has(id))
  for (const recipient_id of existing)
    await createMessage(
      {
        type: 'system',
        recipient_id,
        content: `您反馈的资源链接已有维护结果：${{ explained: '发布者已回应', verified: '已核实可用', relinked: '已补链', stopped: '已停止维护', removed: '链接已移除' }[outcome]}${note ? `。${note}` : ''}`,
        link: `/${uniqueId}?tab=resources#resource-${resourceId}`
      },
      tx
    )
  return existing
}

/** Resource writers call this before taking any case locks. */
export const lockLinkMaintenance = async (tx: Tx, ids: number[]) => {
  if (!ids.length) return
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM patch_resource_link_maintenance WHERE link_id IN (${Prisma.join([...new Set(ids)].sort((a, b) => a - b))}) ORDER BY id ASC FOR UPDATE`
  )
  await tx.$queryRaw(Prisma.sql`SELECT e.id FROM patch_resource_link_maintenance_event e JOIN patch_resource_link_maintenance m ON m.id=e.control_id
    WHERE m.link_id IN (${Prisma.join(ids)}) ORDER BY e.id ASC FOR UPDATE OF e`)
}
export const finishLinkMaintenanceForMutation = async (
  tx: Tx,
  input: {
    links: { id: number; version: number }[]
    resourceId: number
    uniqueId: string
    outcome: 'relinked' | 'removed'
    actorId: number
    now: Date
    excludeRecipientIds?: readonly number[]
  }
) => {
  await lockLinkMaintenance(
    tx,
    input.links.map((link) => link.id)
  )
  const people: number[] = []
  for (const link of input.links) {
    const control = await getMaintenanceControl(tx, link.id, link.version)
    if (!control || !activeEvent(control)) continue
    people.push(
      ...(await finishEvent(tx, control, input.outcome, '', input.now))
    )
    await advance(tx, control)
    await tx.patch_resource_link_maintenance_event.updateMany({
      where: {
        control_id: control.id,
        responded_at: input.now,
        result_notified_at: null
      },
      data: { result_notified_at: input.now }
    })
  }
  return notifyResults(
    tx,
    people.filter((id) => !input.excludeRecipientIds?.includes(id)),
    input.actorId,
    input.uniqueId,
    input.resourceId,
    input.outcome,
    ''
  )
}

export const mutateLinkMaintenance = async (
  submitted: LinkMaintenanceActionInput,
  actor: HealthActor,
  visibility: Prisma.patchWhereInput = {},
  now = new Date()
): Promise<LinkMaintenanceActionResponse> => {
  const parsed = linkMaintenanceActionSchema.safeParse(submitted)
  if (!parsed.success) fail('invalid_request')
  const input = parsed.data
  const { loadHealthTarget, mutateLinkHealthInternal } = await import(
    '../link/service'
  )
  const result = await runResourceMutation(async (tx) => {
    const row = await loadHealthTarget(input, visibility, now, tx, true)
    if (
      row.resource.user_id !== actor.uid ||
      !canManageResourceLink({
        storage: row.storage,
        resourceUserId: row.resource.user_id,
        userId: actor.uid,
        userRole: actor.role
      })
    )
      fail('forbidden')
    let control = await getMaintenanceControl(tx, row.id, row.version)
    if ((control?.revision ?? 0) !== input.maintenanceRevision)
      fail('state_conflict')
    control = await ensureControl(tx, row)
    const event = activeEvent(control)
    const state = maintenanceState(control, now)
    let notified: number[] = []
    if (input.action === 'resume') {
      if (!control.frozen) fail('state_conflict')
      await advance(tx, control, {
        frozen: false,
        stopped_at: null,
        stop_note: ''
      })
    } else if (input.action === 'snooze') {
      if (!event) fail('no_active_event')
      if (state !== 'pending') fail('state_conflict')
      await tx.patch_resource_link_maintenance_event.update({
        where: { id: event.id },
        data: {
          state: 'snoozed',
          snoozed_until: new Date(now.getTime() + input.days * 86400000)
        }
      })
      await advance(tx, control)
    } else {
      if (control.frozen) fail('state_conflict')
      if (input.action === 'respond' && !event) fail('no_active_event')
      const outcome =
        input.action === 'respond'
          ? 'explained'
          : input.action === 'verify'
            ? 'verified'
            : 'stopped'
      const people = await finishEvent(tx, control, outcome, input.note, now)
      await advance(
        tx,
        control,
        input.action === 'stop'
          ? { frozen: true, stopped_at: now, stop_note: input.note }
          : {}
      )
      notified = await notifyResults(
        tx,
        people,
        actor.uid,
        row.resource.patch.unique_id,
        row.resource_id,
        outcome,
        input.note
      )
      if (event)
        await tx.patch_resource_link_maintenance_event.update({
          where: { id: event.id },
          data: { result_notified_at: now }
        })
      if (input.action === 'verify') {
        if (
          input.basis.patchId !== input.patchId ||
          input.basis.resourceId !== input.resourceId ||
          input.basis.linkId !== input.linkId ||
          input.basis.linkVersion !== input.linkVersion
        )
          fail('state_conflict')
        await mutateLinkHealthInternal(
          tx,
          { ...input.basis, action: 'verify' },
          actor,
          visibility,
          now,
          notified
        )
      }
    }
    const item = await getMaintenanceItem(
      targetOf(row),
      { id: actor.uid, role: actor.role, name: '' },
      tx,
      now
    )
    return {
      row,
      response: {
        item,
        link: {
          ...item.health,
          patchId: input.patchId,
          resourceId: input.resourceId,
          linkId: input.linkId
        },
        changed: true,
        notifiedCount: notified.length
      }
    }
  })
  await resourcePostCommit('link-maintenance-cache', () =>
    deletePatchResourceCache(result.row.resource.patch.unique_id)
  )
  return result.response
}
