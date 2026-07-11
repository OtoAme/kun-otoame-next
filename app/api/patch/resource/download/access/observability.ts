export type ResourceAccessOutcome =
  | 'manual_reused'
  | 'daily_limited'
  | 'weekly_limited'
  | 'rate_limited'
  | 'manual_failed'
  | 'restore_succeeded'
  | 'restore_failed'

export const logResourceAccessOutcome = (input: {
  operation: 'access' | 'restore'
  outcome: ResourceAccessOutcome
  actorType: 'visitor' | 'user'
  section?: 'galgame' | 'patch'
}) => {
  console.info('resource-access-outcome', input)
}
