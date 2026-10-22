import { describe, expect, it } from 'vitest'
import {
  assertMaintenanceFeedback,
  maintenanceState,
  maintenanceRestriction
} from '~/app/api/patch/resource/maintenance/policy'
import { linkMaintenanceActionSchema } from '~/validations/linkMaintenance'
import { workspaceValidationFeedback } from '~/validations/workspaceFeedback'
const now = new Date('2026-10-19T00:00:00Z')
describe('version-scoped maintenance policy', () => {
  const actionInput = (
    action: 'respond' | 'stop' | 'verify',
    note: string
  ) => ({
    patchId: 1,
    resourceId: 2,
    linkId: 3,
    linkVersion: 1,
    maintenanceRevision: 0,
    action,
    note,
    ...(action === 'verify'
      ? {
          basis: {
            patchId: 1,
            resourceId: 2,
            linkId: 3,
            linkVersion: 1,
            evidenceRound: 0,
            health: 'broken',
            healthChangedAt: now.toISOString()
          }
        }
      : {})
  })
  it.each(['respond', 'stop', 'verify'] as const)(
    'rejects PostgreSQL-unpersistable NUL in %s notes with safe field feedback',
    (action) => {
      const note = '合成说明\u0000不可持久化'
      const parsed = linkMaintenanceActionSchema.safeParse(
        actionInput(action, note)
      )
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        const feedback = workspaceValidationFeedback(parsed.error)
        expect(feedback.fields.map(({ path }) => path)).toContain('note')
        expect(feedback.message).toContain('不能包含空字符')
        expect(feedback.message).not.toContain(note)
      }
    }
  )
  it.each(['respond', 'stop', 'verify'] as const)(
    'preserves substantive Unicode, newlines, trimming and length boundaries for %s notes',
    (action) => {
      for (const note of ['', ' \n\t ', '界'.repeat(1008)])
        expect(
          linkMaintenanceActionSchema.safeParse(actionInput(action, note))
            .success
        ).toBe(false)
      for (const note of [
        '界'.repeat(1007),
        ' \n日本語😀\n第二行\t ',
        '字面\\u0000文本不含空字符'
      ]) {
        const parsed = linkMaintenanceActionSchema.parse(
          actionInput(action, note)
        )
        expect('note' in parsed && parsed.note).toBe(note.trim())
      }
    }
  )
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
