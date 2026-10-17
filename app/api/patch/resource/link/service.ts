import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import {
  LINK_HEALTH_ERRORS as E,
  LINK_HEALTH_POLICY as P,
  LINK_HEALTH_STATES
} from '~/constants/linkHealth'
import { CASE_UNRESOLVED_STATUSES } from '~/constants/case'
import {
  canCheckResourceLink,
  canManageResourceLink
} from '~/components/patch/resource/resourcePermissions'
import {
  openLinkCaseInternal,
  closeLinkCases,
  readLinkCaseContext
} from '~/app/api/case/linkHealth'
import { lockCaseUsers } from '~/app/api/case/service'
import { createMessage } from '~/app/api/utils/message'
import { deletePatchResourceCache } from '../_helper'
import {
  runResourceMutation,
  resourcePostCommit,
  ResourceMutationError
} from '../mutation'
import {
  getLinkDisputeSources,
  linkHealthSelect,
  projectLinkHealth
} from '../linkHealthProjection'
import {
  linkCheckSnapshotSchema,
  linkHealthTransitionRecordSchema
} from '~/validations/linkHealth'
import {
  reportWeight,
  reportWriteKind,
  reportTransition,
  type HealthTransition
} from './policy'
import type {
  LinkCaseContext,
  LinkCheckSnapshot,
  LinkHealth,
  LinkHealthActionRequest,
  LinkHealthBasis,
  LinkHealthErrorCode,
  LinkHealthMutationResponse,
  LinkHealthResolveRequest,
  LinkHealthTransitionRecord,
  LinkReportRequest,
  LinkReportResponse,
  LinkTarget
} from '~/types/api/linkHealth'

export class LinkHealthError extends ResourceMutationError {
  constructor(public readonly code: LinkHealthErrorCode) {
    super(E[code].message, E[code].status)
  }
}
export type HealthActor = { uid: number; role: number }
const targetSelect = (now: Date) =>
  ({
    ...linkHealthSelect(now),
    resource_id: true,
    resource: {
      select: {
        user_id: true,
        patch_id: true,
        status: true,
        patch: { select: { status: true, unique_id: true } }
      }
    }
  }) satisfies Prisma.patch_resource_linkSelect
export type HealthTargetRow = Prisma.patch_resource_linkGetPayload<{
  select: ReturnType<typeof targetSelect>
}>
export const healthBasis = (row: HealthTargetRow): LinkHealthBasis => ({
  patchId: row.resource.patch_id,
  resourceId: row.resource_id,
  linkId: row.id,
  linkVersion: row.version,
  health: row.health as LinkHealth,
  evidenceRound: row.evidence_round,
  healthChangedAt: row.health_changed_at?.toISOString() ?? null
})
export const loadHealthTarget = async (
  target: LinkTarget,
  visibility: Prisma.patchWhereInput,
  now: Date,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
  lock = false
) => {
  if (lock)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM patch_resource_link WHERE id=${target.linkId} FOR UPDATE`
    )
  const row = await tx.patch_resource_link.findFirst({
    where: {
      id: target.linkId,
      resource_id: target.resourceId,
      resource: {
        patch_id: target.patchId,
        status: 0,
        patch: { status: 0, ...visibility }
      }
    },
    select: targetSelect(now)
  })
  if (!row) throw new LinkHealthError('not_found')
  if (row.version !== target.linkVersion)
    throw new LinkHealthError('version_conflict')
  if (!LINK_HEALTH_STATES.includes(row.health as LinkHealth))
    throw new LinkHealthError('state_conflict')
  return row
}
export const assertHealthBasis = (
  row: HealthTargetRow,
  expected: LinkHealthBasis
) => {
  const actual = healthBasis(row)
  if (
    actual.linkId !== expected.linkId ||
    actual.linkVersion !== expected.linkVersion ||
    actual.resourceId !== expected.resourceId ||
    actual.patchId !== expected.patchId ||
    actual.evidenceRound !== expected.evidenceRound ||
    actual.health !== expected.health ||
    actual.healthChangedAt !== expected.healthChangedAt
  )
    throw new LinkHealthError('state_conflict')
}
export const requireAcquisition = async (
  tx: Prisma.TransactionClient | typeof prisma,
  row: HealthTargetRow,
  uid: number,
  now: Date
) => {
  if (!uid) throw new LinkHealthError('login_required')
  const event = await tx.patch_resource_access.findFirst({
    where: {
      actor_type: 'user',
      user_id: uid,
      link_id: row.id,
      resource_id: row.resource_id,
      link_version: row.version,
      created: { gte: new Date(now.getTime() - P.acquisitionWindowMs) }
    },
    select: { id: true }
  })
  if (!event) throw new LinkHealthError('acquisition_required')
}
export const requireLinkManagement = (
  row: HealthTargetRow,
  actor: HealthActor
) => {
  if (!actor.uid) throw new LinkHealthError('login_required')
  const allowed =
    row.storage === P.staffStorage
      ? actor.role >= P.staffMinRole
      : row.resource.user_id === actor.uid
  if (!allowed) throw new LinkHealthError('forbidden')
}
export const requireLinkCheck = (row: HealthTargetRow, actor: HealthActor) => {
  if (!(actor.uid > 0)) throw new LinkHealthError('login_required')
  if (
    !canCheckResourceLink({
      storage: row.storage,
      content: row.content,
      resourceUserId: row.resource.user_id,
      userId: actor.uid,
      userRole: actor.role
    })
  )
    throw new LinkHealthError('forbidden')
}
const unresolvedCase = (tx: Prisma.TransactionClient, row: HealthTargetRow) =>
  tx.ops_case.findFirst({
    where: {
      target_type: 'link',
      target_id: row.id,
      kind: { in: ['link_suspect', 'link_disputed'] },
      dedup_key: `link:${row.id}:v:${row.version}`,
      status: { in: [...CASE_UNRESOLVED_STATUSES] }
    },
    select: { id: true }
  })
const sourceFor = async (tx: Prisma.TransactionClient, row: HealthTargetRow) =>
  (
    await getLinkDisputeSources(
      [{ ...row, resourceId: row.resource_id, patchId: row.resource.patch_id }],
      tx
    )
  ).get(row.id) ?? null

/** Validated latest snapshot; observation order, not completion order, wins. */
const saveObservation = async (
  tx: Prisma.TransactionClient,
  row: HealthTargetRow,
  snapshot?: LinkCheckSnapshot
) => {
  if (!snapshot) return null
  const decoded = linkCheckSnapshotSchema.safeParse(snapshot)
  if (!decoded.success) throw new LinkHealthError('state_conflict')
  const value = decoded.data
  const qualified = !value.failed && value.verdict !== 'unknown' ? value : null
  const existing = row.check
  const instant = value.checkedAt ?? value.requestedAt
  if (
    existing &&
    existing.link_version === row.version &&
    existing.input_signature === value.inputSignature
  ) {
    const observedAt = Date.parse(instant)
    const existingAt = (existing.checked_at ?? existing.requested_at).getTime()
    // A fresh request may reuse the same qualified cached observation. Keep
    // that attempt current and let it inform the current report threshold,
    // while rejecting older observations and conflicting same-time results.
    if (
      observedAt < existingAt ||
      (observedAt === existingAt &&
        (value.provider !== existing.provider ||
          value.verdict !== existing.verdict ||
          value.reason !== existing.reason ||
          value.failed !== existing.failed))
    )
      return null
    if (
      observedAt === existingAt &&
      Date.parse(value.requestedAt) <= existing.requested_at.getTime()
    )
      return qualified
  }
  const data = {
    patch_id: value.basis.patchId,
    resource_id: value.basis.resourceId,
    link_version: value.basis.linkVersion,
    evidence_round: value.basis.evidenceRound,
    health: value.basis.health,
    health_changed_at: value.basis.healthChangedAt
      ? new Date(value.basis.healthChangedAt)
      : null,
    request_id: value.requestId,
    input_signature: value.inputSignature,
    requested_at: new Date(value.requestedAt),
    completed_at: new Date(value.completedAt),
    verdict: value.verdict,
    provider: value.provider,
    reason: value.reason,
    checked_at: value.checkedAt ? new Date(value.checkedAt) : null,
    cached: value.cached,
    failed: value.failed
  }
  await tx.patch_resource_link_check.upsert({
    where: { link_id: row.id },
    create: { link_id: row.id, ...data },
    update: data
  })
  return qualified
}
const notifyUncasedTransition = async (
  tx: Prisma.TransactionClient,
  row: HealthTargetRow,
  actorId: number | null
) => {
  const recipients =
    row.storage === P.staffStorage
      ? (
          await tx.user.findMany({
            where: { role: { gte: P.staffMinRole } },
            select: { id: true }
          })
        ).map((user) => user.id)
      : [row.resource.user_id]
  const accounts = await lockCaseUsers(tx, recipients)
  for (const id of recipients)
    if (id !== actorId && accounts.has(id))
      await createMessage(
        {
          type: 'system',
          recipient_id: id,
          content: '资源链接的健康状态已更新，请查看对应资源。',
          link: `/${row.resource.patch.unique_id}`
        },
        tx
      )
}
const applyTransition = async (
  tx: Prisma.TransactionClient,
  row: HealthTargetRow,
  transition: HealthTransition,
  now: Date,
  actorType: 'system' | 'staff' | 'publisher' | 'user',
  actorId: number | null,
  observation?: LinkCheckSnapshot | null,
  verify = false
) => {
  if (row.health === transition.health) {
    if (
      row.health === 'disputed' &&
      transition.source === 'machine_user_conflict' &&
      observation?.provider &&
      observation.checkedAt &&
      (await sourceFor(tx, row)) === 'owner_verification'
    ) {
      const reports = await tx.patch_resource_link_report.findMany({
        where: {
          link_id: row.id,
          link_version: row.version,
          evidence_round: row.evidence_round
        },
        select: { user_id: true },
        distinct: ['user_id']
      })
      await openLinkCaseInternal(tx, {
        context: {
          ...healthBasis(row),
          health: 'disputed',
          source: 'machine_user_conflict',
          machine: {
            provider: observation.provider,
            reason: 'share_available',
            checkedAt: observation.checkedAt
          }
        },
        reporterIds: reports.map((report) => report.user_id),
        now
      })
    }
    return false
  }
  const from = healthBasis(row)
  const round =
    row.evidence_round +
    (row.health === 'ok' && transition.health === 'suspect' ? 0 : 1)
  if (round > 2147483647) throw new LinkHealthError('unavailable')
  const to = {
    health: transition.health,
    evidenceRound: round,
    healthChangedAt: now.toISOString()
  }
  const record: LinkHealthTransitionRecord = {
    from,
    to,
    cause: transition.resolution ?? transition.source ?? 'user_reports',
    machine: observation
      ? {
          provider: observation.provider,
          reason: observation.reason,
          checkedAt: observation.checkedAt
        }
      : null
  }
  if (!linkHealthTransitionRecordSchema.safeParse(record).success)
    throw new LinkHealthError('state_conflict')
  const changed = await tx.patch_resource_link.updateMany({
    where: {
      id: row.id,
      version: row.version,
      evidence_round: row.evidence_round,
      health: row.health,
      health_changed_at: row.health_changed_at
    },
    data: {
      health: transition.health,
      evidence_round: round,
      health_changed_at: now,
      ...(verify ? { verified_at: now } : {})
    }
  })
  if (changed.count !== 1) throw new LinkHealthError('state_conflict')
  await tx.patch_resource_link_history.create({
    data: {
      resource_id: row.resource_id,
      link_id: row.id,
      from_version: row.version,
      reason: 'health',
      operator_user_id: actorId,
      health_transition: record as unknown as Prisma.InputJsonValue,
      health_event_key: `link:${row.id}:v:${row.version}:r:${row.evidence_round}:${row.health}:${transition.health}`,
      created: now
    }
  })
  if (transition.resolution) {
    const closed = await closeLinkCases(tx, {
      targets: [{ linkId: row.id, linkVersion: row.version }],
      resolution: transition.resolution,
      actorType,
      actorId,
      now
    })
    if (!closed.closedCaseIds.length)
      await notifyUncasedTransition(tx, row, actorId)
  } else {
    const reporters = await tx.patch_resource_link_report.findMany({
      where: {
        link_id: row.id,
        link_version: row.version,
        evidence_round: row.evidence_round
      },
      select: { user_id: true },
      distinct: ['user_id']
    })
    const context: LinkCaseContext =
      transition.health === 'suspect'
        ? { ...from, ...to, health: 'suspect', source: 'user_reports' }
        : transition.source === 'machine_user_conflict' &&
            observation?.provider &&
            observation.checkedAt
          ? {
              ...from,
              ...to,
              health: 'disputed',
              source: 'machine_user_conflict',
              machine: {
                provider: observation.provider,
                reason: 'share_available',
                checkedAt: observation.checkedAt
              }
            }
          : { ...from, ...to, health: 'disputed', source: 'owner_verification' }
    await openLinkCaseInternal(tx, {
      context,
      reporterIds: reporters.map((report) => report.user_id),
      now
    })
  }
  return true
}
const view = async (
  tx: Prisma.TransactionClient,
  row: HealthTargetRow,
  actor: HealthActor,
  now: Date
) => {
  const fresh = await tx.patch_resource_link.findUniqueOrThrow({
    where: { id: row.id },
    select: targetSelect(now)
  })
  return {
    patchId: fresh.resource.patch_id,
    resourceId: fresh.resource_id,
    linkId: fresh.id,
    ...projectLinkHealth(
      fresh,
      fresh.resource.user_id,
      actor,
      await sourceFor(tx, fresh),
      now
    )
  }
}
const invalidate = (row: HealthTargetRow) =>
  resourcePostCommit('link-health-cache', () =>
    deletePatchResourceCache(row.resource.patch.unique_id)
  )
export type ObservationInput = {
  snapshot: LinkCheckSnapshot
  signature: string
  basis: LinkHealthBasis
  signatureFor: (row: HealthTargetRow) => string
}
const assertObservation = (
  row: HealthTargetRow,
  observation: ObservationInput
) => {
  assertHealthBasis(row, observation.basis)
  assertHealthBasis(row, observation.snapshot.basis)
  if (
    observation.snapshot.inputSignature !== observation.signature ||
    observation.signatureFor(row) !== observation.signature
  )
    throw new LinkHealthError('state_conflict')
}

export const submitLinkReport = async (
  input: LinkReportRequest,
  actor: HealthActor,
  visibility: Prisma.patchWhereInput,
  now = new Date(),
  observation?: ObservationInput,
  expected?: LinkHealthBasis
): Promise<LinkReportResponse> => {
  let invalidation: HealthTargetRow | undefined
  const result = await runResourceMutation(async (tx) => {
    const row = await loadHealthTarget(input, visibility, now, tx, true)
    if (expected) assertHealthBasis(row, expected)
    if (observation) {
      assertObservation(row, observation)
    }
    await requireAcquisition(tx, row, actor.uid, now)
    const source = await sourceFor(tx, row)
    const identity = {
      link_id: row.id,
      link_version: row.version,
      evidence_round: row.evidence_round,
      user_id: actor.uid
    }
    const existing = await tx.patch_resource_link_report.findUnique({
      where: { link_id_link_version_evidence_round_user_id: identity }
    })
    const old = await tx.patch_resource_link_report.findFirst({
      where: {
        link_id: row.id,
        link_version: row.version,
        user_id: actor.uid,
        evidence_round: { lt: row.evidence_round },
        ever_counted: true
      },
      select: { id: true }
    })
    const weight = reportWeight({
      reason: input.reason,
      health: row.health as LinkHealth,
      oldReporter: Boolean(old),
      verifiedAt: row.verified_at,
      disputeSource: source,
      now
    })
    const report = reportWriteKind(
      existing
        ? { weight: Number(existing.weight), created: existing.created }
        : null,
      weight,
      now
    )
    if (report === 'duplicate' && !observation)
      return {
        link: await view(tx, row, actor, now),
        changed: false,
        report,
        weight: Number(existing!.weight) as 0 | 0.5 | 1,
        caseId: (await unresolvedCase(tx, row))?.id ?? null
      }
    const data = {
      reason: input.reason,
      weight,
      ever_counted: Boolean(existing?.ever_counted) || weight > 0,
      created: now
    }
    const actualWeight =
      report === 'duplicate'
        ? (Number(existing!.weight) as 0 | 0.5 | 1)
        : weight
    if (report !== 'duplicate' && existing)
      await tx.patch_resource_link_report.update({
        where: { id: existing.id },
        data
      })
    else if (report !== 'duplicate')
      await tx.patch_resource_link_report.create({
        data: { ...identity, ...data }
      })
    const machine = await saveObservation(tx, row, observation?.snapshot)
    const sum = await tx.patch_resource_link_report.aggregate({
      where: {
        link_id: row.id,
        link_version: row.version,
        evidence_round: row.evidence_round,
        created: { gte: new Date(now.getTime() - P.reportWindowMs) }
      },
      _sum: { weight: true }
    })
    const transition = reportTransition({
      health: row.health as LinkHealth,
      verifiedAt: row.verified_at,
      disputeSource: source,
      weight: Number(sum._sum.weight ?? 0),
      machine:
        machine?.verdict === 'available'
          ? 'available'
          : machine?.verdict === 'broken'
            ? 'broken'
            : null,
      now
    })
    const changed = transition
      ? await applyTransition(tx, row, transition, now, 'system', null, machine)
      : false
    if (
      !changed &&
      row.health_changed_at &&
      (row.health === 'suspect' || (row.health === 'disputed' && source))
    ) {
      const context =
        row.health === 'suspect'
          ? {
              ...healthBasis(row),
              health: 'suspect' as const,
              source: 'user_reports' as const
            }
          : null
      if (context)
        await openLinkCaseInternal(tx, {
          context,
          reporterIds: [actor.uid],
          now
        })
      else {
        const active = await unresolvedCase(tx, row)
        if (active) {
          const accounts = await lockCaseUsers(tx, [actor.uid])
          if (accounts.has(actor.uid))
            await tx.ops_case_subscriber.createMany({
              data: [{ case_id: active.id, user_id: actor.uid }],
              skipDuplicates: true
            })
        }
      }
    }
    invalidation = row
    return {
      link: await view(tx, row, actor, now),
      changed,
      report,
      weight: actualWeight,
      caseId: (await unresolvedCase(tx, row))?.id ?? null
    }
  })
  if (invalidation) await invalidate(invalidation)
  return result
}

export const mutateLinkHealth = async (
  input: LinkHealthActionRequest | LinkHealthResolveRequest,
  actor: HealthActor,
  visibility: Prisma.patchWhereInput,
  now = new Date()
): Promise<LinkHealthMutationResponse> => {
  const result = await runResourceMutation(async (tx) => {
    const row = await loadHealthTarget(input, visibility, now, tx, true)
    assertHealthBasis(row, input)
    const resolve = input.action === 'available' || input.action === 'broken'
    if (resolve) {
      if (actor.role < P.staffMinRole || !actor.uid)
        throw new LinkHealthError('forbidden')
      if (row.health !== 'disputed') throw new LinkHealthError('state_conflict')
    } else {
      requireLinkManagement(row, actor)
      if (
        input.action === 'verify'
          ? !['suspect', 'broken'].includes(row.health)
          : row.health !== 'suspect'
      )
        throw new LinkHealthError('state_conflict')
    }
    if (
      input.action === 'verify' &&
      row.verified_at &&
      now.getTime() - row.verified_at.getTime() < P.verificationIntervalMs
    )
      throw new LinkHealthError('verification_cooldown')
    const transition: HealthTransition =
      input.action === 'verify'
        ? { health: 'ok', resolution: 'verified_available' }
        : input.action === 'confirm_broken'
          ? { health: 'broken', resolution: 'confirmed_broken' }
          : input.action === 'available'
            ? { health: 'ok', resolution: 'staff_available' }
            : { health: 'broken', resolution: 'staff_broken' }
    const changed = await applyTransition(
      tx,
      row,
      transition,
      now,
      actor.role >= P.staffMinRole ? 'staff' : 'publisher',
      actor.uid,
      null,
      input.action === 'verify'
    )
    return { response: { link: await view(tx, row, actor, now), changed }, row }
  })
  await invalidate(result.row)
  return result.response
}

export const acceptLinkCheck = async (
  target: LinkTarget,
  actor: HealthActor,
  visibility: Prisma.patchWhereInput,
  observation: ObservationInput,
  now = new Date(),
  mode: 'manual' | 'automatic' = 'manual'
) => {
  const result = await runResourceMutation(async (tx) => {
    const row = await loadHealthTarget(target, visibility, now, tx, true)
    assertObservation(row, observation)
    requireLinkCheck(row, actor)
    const machine = await saveObservation(tx, row, observation.snapshot)
    const sum = await tx.patch_resource_link_report.aggregate({
      where: {
        link_id: row.id,
        link_version: row.version,
        evidence_round: row.evidence_round,
        created: { gte: new Date(now.getTime() - P.reportWindowMs) }
      },
      _sum: { weight: true }
    })
    const transition = machine
      ? reportTransition({
          health: row.health as LinkHealth,
          verifiedAt: row.verified_at,
          disputeSource: await sourceFor(tx, row),
          weight: Number(sum._sum.weight ?? 0),
          machine: machine.verdict === 'available' ? 'available' : 'broken',
          now
        })
      : null
    const changed = transition
      ? await applyTransition(
          tx,
          row,
          transition,
          now,
          mode === 'automatic'
            ? 'system'
            : actor.role >= P.staffMinRole
              ? 'staff'
              : canManageResourceLink({
                  storage: row.storage,
                  resourceUserId: row.resource.user_id,
                  userId: actor.uid,
                  userRole: actor.role
                })
                ? 'publisher'
                : 'user',
          mode === 'automatic' ? null : actor.uid,
          machine
        )
      : false
    return {
      row,
      response: {
        link: await view(tx, row, actor, now),
        changed,
        check: observation.snapshot.failed
          ? ('failed' as const)
          : ('observed' as const)
      }
    }
  })
  await invalidate(result.row)
  return result.response
}

export const runDueLinkHealth = async (
  basis: LinkHealthBasis,
  now = new Date()
) => {
  const result = await runResourceMutation(async (tx) => {
    let row: HealthTargetRow
    try {
      row = await loadHealthTarget(basis, {}, now, tx, true)
      assertHealthBasis(row, basis)
    } catch (error) {
      if (error instanceof LinkHealthError) return null
      throw error
    }
    const since = row.health_changed_at?.getTime()
    if (since === undefined) return null
    const active = await unresolvedCase(tx, row)
    const context = active ? await readLinkCaseContext(tx, active.id) : null
    if (!context) return null
    try {
      assertHealthBasis(row, context)
    } catch {
      return null
    }
    let transition: HealthTransition | null = null
    if (row.health === 'suspect' && now.getTime() - since >= P.suspectTimeoutMs)
      transition = { health: 'broken', resolution: 'timeout_broken' }
    if (
      row.health === 'disputed' &&
      now.getTime() - since >= P.disputeConvergenceMs &&
      (await sourceFor(tx, row)) === 'owner_verification'
    )
      transition = { health: 'ok', resolution: 'auto_available' }
    if (!transition) return null
    const changed = await applyTransition(
      tx,
      row,
      transition,
      now,
      'system',
      null
    )
    return { row, changed }
  })
  if (result) await invalidate(result.row)
  return { changed: result?.changed ?? false }
}
