import { LINK_MAINTENANCE_ERRORS as E } from '~/constants/linkMaintenance'
import { ResourceMutationError } from '../mutation'
import type {
  LinkMaintenanceAction,
  LinkMaintenanceRestriction,
  LinkMaintenanceState
} from '~/types/api/linkMaintenance'

export type MaintenanceEventFact = { state: string; snoozed_until: Date | null }
export type MaintenanceControlFact = {
  revision: number
  frozen: boolean
  events: MaintenanceEventFact[]
}
export const maintenanceRestriction = (
  control: MaintenanceControlFact | null | undefined,
  now: Date
): LinkMaintenanceRestriction => {
  const event = control?.events.find((item) => item.state !== 'handled')
  const snoozed =
    event?.state === 'snoozed' &&
    event.snoozed_until !== null &&
    event.snoozed_until > now
  return {
    revision: control?.revision ?? 0,
    restriction: control?.frozen ? 'stopped' : snoozed ? 'snoozed' : null,
    resumesAt:
      !control?.frozen && snoozed ? event.snoozed_until!.toISOString() : null
  }
}
export const assertMaintenanceFeedback = (
  control: MaintenanceControlFact | null | undefined,
  now: Date
) => {
  const restriction = maintenanceRestriction(control, now).restriction
  if (restriction) {
    const error =
      restriction === 'stopped' ? E.feedback_stopped : E.feedback_snoozed
    throw new ResourceMutationError(error.message, error.status)
  }
}
export const maintenanceState = (
  control: MaintenanceControlFact | null | undefined,
  now: Date
): LinkMaintenanceState => {
  if (control?.frozen) return 'stopped'
  const event = control?.events[0]
  if (!event) return 'optional'
  if (event.state === 'handled') return 'handled'
  return event.state === 'snoozed' &&
    event.snoozed_until &&
    event.snoozed_until > now
    ? 'snoozed'
    : 'pending'
}
export const maintenanceActions = (
  state: LinkMaintenanceState,
  canVerify: boolean
): LinkMaintenanceAction[] => {
  if (state === 'stopped') return ['resume']
  return [
    ...(state === 'pending' || state === 'snoozed' ? ['respond' as const] : []),
    ...(canVerify ? ['verify' as const] : []),
    ...(state === 'pending' ? ['snooze' as const] : []),
    'stop'
  ]
}
