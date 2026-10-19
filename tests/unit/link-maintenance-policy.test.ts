import { describe, expect, it } from 'vitest'
import {
  assertMaintenanceFeedback,
  maintenanceState,
  maintenanceRestriction
} from '~/app/api/patch/resource/maintenance/policy'
import { linkMaintenanceActionSchema } from '~/validations/linkMaintenance'
const now = new Date('2026-10-19T00:00:00Z')
describe('version-scoped maintenance policy', () => {
  it('expires snooze at the exact server boundary without changing its control or round', () => {
    const fact = {
      revision: 7,
      frozen: false,
      events: [{ state: 'snoozed', snoozed_until: now }]
    }
    expect(maintenanceState(fact, now)).toBe('pending')
    expect(maintenanceRestriction(fact, now)).toEqual({
      revision: 7,
      restriction: null,
      resumesAt: null
    })
    expect(() => assertMaintenanceFeedback(fact, now)).not.toThrow()
    expect(fact.events[0].state).toBe('snoozed')
    fact.events[0].snoozed_until = new Date(now.getTime() + 1)
    expect(() => assertMaintenanceFeedback(fact, now)).toThrow('暂缓')
  })
  it('keeps freeze after handled health and never equates healthy to handled maintenance', () => {
    expect(
      maintenanceState(
        {
          revision: 2,
          frozen: false,
          events: [{ state: 'pending', snoozed_until: null }]
        },
        now
      )
    ).toBe('pending')
    expect(() =>
      assertMaintenanceFeedback({ revision: 2, frozen: true, events: [] }, now)
    ).toThrow('停止维护')
  })
  it('requires substantive final notes and rejects client clocks, identity and unknown action data', () => {
    const base = {
      patchId: 1,
      resourceId: 2,
      linkId: 3,
      linkVersion: 1,
      maintenanceRevision: 0
    }
    expect(
      linkMaintenanceActionSchema.safeParse({
        ...base,
        action: 'respond',
        note: ' '
      }).success
    ).toBe(false)
    for (const extra of [
      { days: 7 },
      { days: 1, snoozedUntil: now.toISOString() },
      { days: 1, uid: 4 }
    ])
      expect(
        linkMaintenanceActionSchema.safeParse({
          ...base,
          action: 'snooze',
          ...extra
        }).success
      ).toBe(false)
    expect(
      linkMaintenanceActionSchema.parse({ ...base, action: 'snooze', days: 3 })
    ).toMatchObject({ days: 3 })
  })
})
