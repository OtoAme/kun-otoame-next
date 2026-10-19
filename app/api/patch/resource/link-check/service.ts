import { randomUUID } from 'node:crypto'
import { prisma } from '~/prisma/index'
import { LINK_HEALTH_POLICY as P } from '~/constants/linkHealth'
import { canCheckResourceLink } from '~/components/patch/resource/resourcePermissions'
import { getLinkDisputeSources } from '../linkHealthProjection'
import {
  healthBasis,
  loadHealthTarget,
  assertHealthBasis,
  requireAcquisition,
  requireLinkCheck,
  submitLinkReport,
  acceptLinkCheck,
  LinkHealthError,
  type HealthActor,
  type HealthTargetRow
} from '../link/service'
import { reportWeight, reportWriteKind } from '../link/policy'
import { assertLinkMaintenanceFeedbackOpen } from '../maintenance/service'
import { prepareLinkCheckInput, checkLink } from './checker'
import { getLinkCheckerConfig } from './config'
import type { Prisma } from '@prisma/client'
import type {
  LinkCheckIdentity,
  LinkCheckSnapshot,
  LinkCheckSummary,
  LinkHealthBasis,
  LinkReportRequest
} from '~/types/api/linkHealth'
import type { PatchResourceStableUpdateResponse } from '~/types/api/patch'
export type LinkCheckOptions = {
  config?: { endpoint: string; apiKey: string }
  now?: () => Date
  fetch?: typeof fetch
}
const execute = async (row: HealthTargetRow, options: LinkCheckOptions) => {
  const now = options.now ?? (() => new Date())
  const prepared = prepareLinkCheckInput(row)
  const identity: LinkCheckIdentity = {
    requestId: randomUUID(),
    basis: healthBasis(row),
    inputSignature: prepared.inputSignature,
    requestedAt: now().toISOString()
  }
  let snapshot: LinkCheckSnapshot
  try {
    snapshot = await checkLink(identity, prepared, {
      config: options.config ?? getLinkCheckerConfig(),
      now,
      fetch: options.fetch
    })
  } catch {
    snapshot = {
      ...identity,
      completedAt: now().toISOString(),
      cached: false,
      verdict: 'unknown',
      provider: prepared.provider,
      reason: 'unavailable',
      failed: true,
      checkedAt: null
    }
  }
  return {
    snapshot,
    signature: prepared.inputSignature,
    basis: identity.basis,
    signatureFor: (current: HealthTargetRow) =>
      prepareLinkCheckInput(current).inputSignature
  }
}
export const reportLinkWithCheck = async (
  input: LinkReportRequest,
  actor: HealthActor,
  visibility: Prisma.patchWhereInput,
  options: LinkCheckOptions = {}
) => {
  const now = options.now ?? (() => new Date())
  const row = await loadHealthTarget(input, visibility, now())
  await assertLinkMaintenanceFeedbackOpen(prisma, row, now())
  await requireAcquisition(prisma, row, actor.uid, now())
  const basis = healthBasis(row)
  const existing = await prisma.patch_resource_link_report.findUnique({
    where: {
      link_id_link_version_evidence_round_user_id: {
        link_id: row.id,
        link_version: row.version,
        evidence_round: row.evidence_round,
        user_id: actor.uid
      }
    }
  })
  if (existing) {
    const old = await prisma.patch_resource_link_report.findFirst({
      where: {
        link_id: row.id,
        link_version: row.version,
        user_id: actor.uid,
        evidence_round: { lt: row.evidence_round },
        ever_counted: true
      },
      select: { id: true }
    })
    const sources = await getLinkDisputeSources([
      { ...row, resourceId: row.resource_id, patchId: row.resource.patch_id }
    ])
    const weight = reportWeight({
      reason: input.reason,
      health: basis.health,
      oldReporter: Boolean(old),
      verifiedAt: row.verified_at,
      disputeSource: sources.get(row.id) ?? null,
      now: now()
    })
    if (
      reportWriteKind(
        { weight: Number(existing.weight), created: existing.created },
        weight,
        now()
      ) === 'duplicate'
    )
      return submitLinkReport(input, actor, visibility, now(), undefined, basis)
  }
  const observation = await execute(row, options)
  return submitLinkReport(input, actor, visibility, now(), observation)
}
export const checkManagedLink = async (
  input: LinkHealthBasis,
  actor: HealthActor,
  visibility: Prisma.patchWhereInput,
  options: LinkCheckOptions = {},
  mode: 'manual' | 'automatic' = 'manual'
) => {
  const now = options.now ?? (() => new Date())
  const row = await loadHealthTarget(input, visibility, now())
  assertHealthBasis(row, input)
  requireLinkCheck(row, actor)
  const observation = await execute(row, options)
  const response = await acceptLinkCheck(
    input,
    actor,
    visibility,
    observation,
    now(),
    mode
  )
  return {
    response: { ...response, result: safeSummary(observation.snapshot, now()) },
    snapshot: observation.snapshot
  }
}
export const manualLinkCheck = async (
  input: LinkHealthBasis,
  actor: HealthActor,
  visibility: Prisma.patchWhereInput
) => (await checkManagedLink(input, actor, visibility)).response
const safeSummary = (
  snapshot: LinkCheckSnapshot,
  now: Date
): LinkCheckSummary => {
  const common = {
    attemptedAt: snapshot.requestedAt,
    stale:
      snapshot.checkedAt !== null &&
      now.getTime() - Date.parse(snapshot.checkedAt) >= P.checkDisplayTtlMs
  }
  return snapshot.failed
    ? {
        ...common,
        verdict: 'unknown',
        provider: snapshot.provider,
        reason: snapshot.reason,
        failed: true,
        checkedAt: null
      }
    : ({
        ...common,
        verdict: snapshot.verdict,
        provider: snapshot.provider,
        reason: snapshot.reason,
        failed: false,
        checkedAt: snapshot.checkedAt
      } as LinkCheckSummary)
}
export const checkRelinkedResource = async (
  response: PatchResourceStableUpdateResponse,
  base: readonly { id: number; version: number }[],
  actor: HealthActor,
  options: LinkCheckOptions = {}
) => {
  const now = options.now ?? (() => new Date())
  const targets = response.links.filter(
    (link) =>
      base.find((entry) => entry.id === link.id)?.version !== link.version
  )
  for (const link of targets) {
    const target = {
      patchId: response.patchId,
      resourceId: response.id,
      linkId: link.id,
      linkVersion: link.version
    }
    const basis = {
      ...target,
      evidenceRound: link.evidenceRound,
      health: link.health,
      healthChangedAt: link.healthChangedAt
    }
    try {
      const row = await loadHealthTarget(basis, {}, now())
      assertHealthBasis(row, basis)
      if (
        !canCheckResourceLink({
          storage: row.storage,
          content: row.content,
          resourceUserId: row.resource.user_id,
          userId: actor.uid,
          userRole: actor.role
        })
      )
        continue
      const checked = await checkManagedLink(
        basis,
        actor,
        {},
        options,
        'automatic'
      )
      response.linkChecks.push({
        linkId: link.id,
        linkVersion: link.version,
        outcome: checked.snapshot.failed ? 'failed' : 'observed',
        check: safeSummary(checked.snapshot, now())
      })
      const {
        patchId: _patchId,
        resourceId: _resourceId,
        linkId: _linkId,
        ...health
      } = checked.response.link
      Object.assign(link, health)
    } catch (error) {
      if (error instanceof LinkHealthError) {
        response.linkChecks.push({
          linkId: link.id,
          linkVersion: link.version,
          outcome: 'superseded',
          check: null
        })
        continue
      }
      response.linkChecks.push({
        linkId: link.id,
        linkVersion: link.version,
        outcome: 'failed',
        check: {
          verdict: 'unknown',
          provider: null,
          reason: 'unavailable',
          failed: true,
          checkedAt: null,
          attemptedAt: now().toISOString(),
          stale: false
        }
      })
    }
  }
  return response
}
