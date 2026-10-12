import {
  LINK_HEALTH_POLICY as P,
  LINK_REPORT_WEIGHTS
} from '~/constants/linkHealth'
import type {
  LinkCaseResolution,
  LinkDisputeSource,
  LinkHealth,
  LinkReportReason
} from '~/types/api/linkHealth'

export const reportWeight = (input: {
  reason: LinkReportReason
  health: LinkHealth
  oldReporter: boolean
  verifiedAt: Date | null
  disputeSource: LinkDisputeSource | null
  now: Date
}): 0 | 0.5 | 1 => {
  if (
    input.oldReporter &&
    input.verifiedAt &&
    input.now.getTime() - input.verifiedAt.getTime() < P.reporterCooldownMs
  )
    return 0
  if (
    input.health === 'disputed' &&
    input.disputeSource !== 'machine_user_conflict' &&
    (input.oldReporter || input.reason === 'unreachable')
  )
    return 0
  return LINK_REPORT_WEIGHTS[input.reason]
}

export const reportWriteKind = (
  existing: { weight: number; created: Date } | null,
  weight: number,
  now: Date
) =>
  !existing
    ? ('recorded' as const)
    : (existing.weight > 0 &&
          existing.created.getTime() >= now.getTime() - P.reportWindowMs) ||
        (existing.weight === 0 && weight === 0)
      ? ('duplicate' as const)
      : ('renewed' as const)

export type HealthTransition = {
  health: LinkHealth
  source?: LinkDisputeSource | 'user_reports'
  resolution?: LinkCaseResolution
}
export const reportTransition = (input: {
  health: LinkHealth
  verifiedAt: Date | null
  disputeSource: LinkDisputeSource | null
  weight: number
  machine: 'available' | 'broken' | null
  now: Date
}): HealthTransition | null => {
  if (input.machine === 'broken' && input.health !== 'broken')
    return { health: 'broken', resolution: 'machine_broken' }
  if (input.health === 'broken') return null
  if (
    input.machine === 'available' &&
    input.weight >= P.reportThreshold &&
    (input.health !== 'disputed' ||
      input.disputeSource === 'owner_verification')
  )
    return { health: 'disputed', source: 'machine_user_conflict' }
  if (input.health === 'ok' && input.weight >= P.reportThreshold)
    return input.verifiedAt &&
      input.now.getTime() - input.verifiedAt.getTime() <
        P.verificationIntervalMs
      ? { health: 'disputed', source: 'owner_verification' }
      : { health: 'suspect', source: 'user_reports' }
  if (
    input.health === 'disputed' &&
    input.disputeSource === 'owner_verification' &&
    input.weight >= P.reportThreshold
  )
    return { health: 'broken', resolution: 'auto_broken' }
  return null
}
