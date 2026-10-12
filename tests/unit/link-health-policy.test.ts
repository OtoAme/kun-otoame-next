import { describe, expect, it } from 'vitest'
import {
  reportWeight,
  reportWriteKind,
  reportTransition
} from '~/app/api/patch/resource/link/policy'
import { LINK_HEALTH_POLICY as P } from '~/constants/linkHealth'
const now = new Date('2026-10-09T00:00:00Z')
const weightInput = {
  reason: 'deleted' as const,
  health: 'ok' as const,
  oldReporter: false,
  verifiedAt: null,
  disputeSource: null,
  now
}
const transitionInput = {
  health: 'ok' as const,
  verifiedAt: null,
  disputeSource: null,
  weight: 3,
  machine: null,
  now
}
describe('link evidence and health policy', () => {
  it('counts only new positive evidence through verified cooling and ordinary dispute rules', () => {
    expect(reportWeight(weightInput)).toBe(1)
    expect(reportWeight({ ...weightInput, reason: 'unreachable' })).toBe(0.5)
    const verifiedAt = new Date(now.getTime() - P.reporterCooldownMs + 1)
    expect(
      reportWeight({ ...weightInput, oldReporter: true, verifiedAt })
    ).toBe(0)
    expect(
      reportWeight({
        ...weightInput,
        oldReporter: true,
        verifiedAt: new Date(now.getTime() - P.reporterCooldownMs)
      })
    ).toBe(1)
    expect(
      reportWeight({
        ...weightInput,
        health: 'disputed',
        oldReporter: true,
        disputeSource: 'owner_verification'
      })
    ).toBe(0)
    expect(
      reportWeight({
        ...weightInput,
        health: 'disputed',
        reason: 'unreachable',
        disputeSource: 'owner_verification'
      })
    ).toBe(0)
    expect(
      reportWeight({
        ...weightInput,
        health: 'disputed',
        disputeSource: 'owner_verification'
      })
    ).toBe(1)
  })
  it('keeps effective votes fixed through exactly 72 hours but permits intentional expired renewal and zero promotion', () => {
    expect(
      reportWriteKind(
        { weight: 1, created: new Date(now.getTime() - P.reportWindowMs) },
        1,
        now
      )
    ).toBe('duplicate')
    expect(
      reportWriteKind(
        { weight: 1, created: new Date(now.getTime() - P.reportWindowMs - 1) },
        1,
        now
      )
    ).toBe('renewed')
    expect(reportWriteKind({ weight: 0, created: now }, 0, now)).toBe(
      'duplicate'
    )
    expect(reportWriteKind({ weight: 0, created: now }, 1, now)).toBe('renewed')
  })
  it('distinguishes current user thresholds, fresh machines and persistent machine conflict', () => {
    expect(reportTransition(transitionInput)).toEqual({
      health: 'suspect',
      source: 'user_reports'
    })
    expect(
      reportTransition({ ...transitionInput, machine: 'available' })
    ).toEqual({ health: 'disputed', source: 'machine_user_conflict' })
    expect(
      reportTransition({ ...transitionInput, weight: 0, machine: 'broken' })
    ).toEqual({ health: 'broken', resolution: 'machine_broken' })
    expect(
      reportTransition({
        ...transitionInput,
        health: 'disputed',
        disputeSource: 'machine_user_conflict',
        weight: 20
      })
    ).toBeNull()
    expect(
      reportTransition({
        ...transitionInput,
        health: 'broken',
        machine: 'available'
      })
    ).toBeNull()
    expect(
      reportTransition({
        ...transitionInput,
        health: 'disputed',
        disputeSource: 'owner_verification'
      })
    ).toEqual({ health: 'broken', resolution: 'auto_broken' })
    expect(
      reportTransition({
        ...transitionInput,
        health: 'disputed',
        disputeSource: 'owner_verification',
        machine: 'available'
      })
    ).toEqual({ health: 'disputed', source: 'machine_user_conflict' })
  })
  it('uses the exact 30-day verification boundary without extending it through other state clocks', () => {
    expect(
      reportTransition({
        ...transitionInput,
        verifiedAt: new Date(now.getTime() - P.verificationIntervalMs + 1)
      })
    ).toEqual({ health: 'disputed', source: 'owner_verification' })
    expect(
      reportTransition({
        ...transitionInput,
        verifiedAt: new Date(now.getTime() - P.verificationIntervalMs)
      })
    ).toEqual({ health: 'suspect', source: 'user_reports' })
  })
})
