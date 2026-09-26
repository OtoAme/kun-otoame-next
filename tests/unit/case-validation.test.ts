import { describe, expect, it } from 'vitest'
import {
  CASE_ADMIN_ACTIONS,
  CASE_CONTENT_ACTIONS,
  CASE_KINDS,
  CASE_RESOLUTIONS,
  CASE_RESOURCE_ACTIONS,
  CASE_STATUSES,
  CASE_TABS,
  CASE_TARGET_TYPES
} from '~/constants/case'
import {
  adminCaseContentBodySchema,
  adminCaseHandleBodySchema,
  adminCaseListSchema,
  adminCaseResourceBodySchema,
  appendCaseMessageBodySchema,
  caseIdParamSchema,
  caseKindSchema,
  caseListSchema,
  caseResolutionSchema,
  caseStatusSchema,
  caseTabSchema,
  caseTargetTypeSchema,
  createCaseSchema,
  resolveCaseBodySchema
} from '~/validations/case'

const repeat = (char: string, length: number) => char.repeat(length)

describe('case validation', () => {
  it('accepts the registered enums and rejects unknown values', () => {
    for (const value of CASE_KINDS) {
      expect(caseKindSchema.safeParse(value).success).toBe(true)
    }
    for (const value of CASE_TARGET_TYPES) {
      expect(caseTargetTypeSchema.safeParse(value).success).toBe(true)
    }
    for (const value of CASE_STATUSES) {
      expect(caseStatusSchema.safeParse(value).success).toBe(true)
    }
    for (const value of CASE_TABS) {
      expect(caseTabSchema.safeParse(value).success).toBe(true)
    }
    for (const value of CASE_RESOLUTIONS) {
      expect(caseResolutionSchema.safeParse(value).success).toBe(true)
    }

    expect(caseKindSchema.safeParse('unknown_kind').success).toBe(false)
    expect(caseTargetTypeSchema.safeParse('unknown_target').success).toBe(false)
    expect(caseStatusSchema.safeParse('unknown_status').success).toBe(false)
    expect(caseTabSchema.safeParse('unknown_tab').success).toBe(false)
    expect(caseResolutionSchema.safeParse('unknown_resolution').success).toBe(
      false
    )

    for (const value of CASE_ADMIN_ACTIONS) {
      expect(
        adminCaseHandleBodySchema.safeParse({ action: value }).success
      ).toBe(true)
    }
    for (const value of CASE_RESOURCE_ACTIONS) {
      expect(
        adminCaseResourceBodySchema.safeParse({ action: value }).success
      ).toBe(true)
    }
    for (const value of CASE_CONTENT_ACTIONS) {
      expect(
        adminCaseContentBodySchema.safeParse({ action: value }).success
      ).toBe(true)
    }
  })

  it('keeps list defaults and rejects invalid pagination', () => {
    expect(caseListSchema.parse({})).toEqual({
      tab: 'reported',
      page: 1,
      limit: 20
    })
    expect(adminCaseListSchema.parse({})).toEqual({
      ownerType: 'staff',
      page: 1,
      limit: 20,
      search: ''
    })

    for (const input of [
      { page: '0' },
      { page: '1.5' },
      { limit: '0' },
      { limit: '101' },
      { tab: 'all' },
      { status: 'pending' }
    ]) {
      expect(
        caseListSchema.safeParse(input).success,
        JSON.stringify(input)
      ).toBe(false)
    }
    expect(adminCaseListSchema.safeParse({ kind: 'unknown' }).success).toBe(
      false
    )
    expect(
      adminCaseListSchema.safeParse({ search: repeat('a', 301) }).success
    ).toBe(false)

    expect(caseListSchema.safeParse({ page: '1', limit: '100' }).success).toBe(
      true
    )
    expect(
      adminCaseListSchema.safeParse({ page: '1', limit: '100' }).success
    ).toBe(true)
  })

  it('requires positive integer path IDs within the Int range', () => {
    for (const raw of [
      '0',
      '-1',
      '1.5',
      'NaN',
      'Infinity',
      '2147483648',
      '9007199254740992'
    ]) {
      expect(caseIdParamSchema.safeParse({ id: raw }).success, raw).toBe(false)
    }

    expect(caseIdParamSchema.parse({ id: '1' })).toEqual({ id: 1 })
    expect(caseIdParamSchema.parse({ id: '2147483647' })).toEqual({
      id: 2147483647
    })
  })

  it('enforces kind-specific report and description lengths', () => {
    const resourceMismatch = {
      kind: 'resource_mismatch' as const,
      targetType: 'resource' as const,
      targetId: 10
    }
    expect(
      createCaseSchema.safeParse({
        ...resourceMismatch,
        content: repeat('a', 9)
      }).success
    ).toBe(false)
    expect(
      createCaseSchema.safeParse({
        ...resourceMismatch,
        content: repeat('a', 10)
      }).success
    ).toBe(true)

    const violation = {
      kind: 'content_violation' as const,
      targetType: 'comment' as const,
      targetId: 10
    }
    expect(
      createCaseSchema.safeParse({ ...violation, content: 'a' }).success
    ).toBe(false)
    expect(
      createCaseSchema.safeParse({ ...violation, content: 'ab' }).success
    ).toBe(true)

    for (const input of [
      { ...resourceMismatch, content: repeat('a', 5001) },
      { ...violation, content: repeat('a', 5001) }
    ]) {
      expect(createCaseSchema.safeParse(input).success).toBe(false)
    }

    expect(appendCaseMessageBodySchema.safeParse({ content: '' }).success).toBe(
      false
    )
    expect(
      appendCaseMessageBodySchema.safeParse({ content: 'a' }).success
    ).toBe(true)
    expect(
      appendCaseMessageBodySchema.safeParse({
        content: repeat('a', 5000)
      }).success
    ).toBe(true)
    expect(
      appendCaseMessageBodySchema.safeParse({
        content: repeat('a', 5001)
      }).success
    ).toBe(false)
  })

  it('strips derived and path-owned fields from client bodies', () => {
    expect(
      createCaseSchema.parse({
        kind: 'other',
        targetType: 'patch',
        targetId: 10,
        expectedPatchId: 10,
        content: '  条目资料需要进一步核对  ',
        ownerType: 'publisher',
        ownerId: 20,
        public: true,
        source: 'system',
        patchId: 999,
        reporterId: 20,
        dedupKey: 'forged'
      })
    ).toEqual({
      kind: 'other',
      targetType: 'patch',
      targetId: 10,
      expectedPatchId: 10,
      content: '条目资料需要进一步核对',
      imageKeys: []
    })

    expect(
      appendCaseMessageBodySchema.parse({ caseId: 999, content: '回复' })
    ).toEqual({ content: '回复', imageKeys: [] })
    expect(
      resolveCaseBodySchema.parse({
        caseId: 999,
        resolution: 'handled',
        content: '说明'
      })
    ).toEqual({ resolution: 'handled', content: '说明' })
  })

  it('accepts the confirmed user-handled explanation contract', () => {
    expect(
      adminCaseHandleBodySchema.parse({
        caseId: 999,
        action: 'resolve',
        resolution: 'handled',
        content: '已在既有用户管理入口完成处置',
        handledUserConfirmed: true,
        ownerType: 'publisher'
      })
    ).toEqual({
      action: 'resolve',
      resolution: 'handled',
      content: '已在既有用户管理入口完成处置',
      handledUserConfirmed: true
    })

    expect(
      adminCaseHandleBodySchema.safeParse({
        action: 'resolve',
        resolution: 'handled',
        content: '说明',
        handledUserConfirmed: 'true'
      }).success
    ).toBe(false)
  })
})
