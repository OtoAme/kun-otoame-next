import { describe, expect, it } from 'vitest'
import {
  buildLinkBasis,
  buildLinkTarget,
  brokenLinksFoldText,
  countBrokenLinks,
  isLinkConflictError,
  latestRelinkAt,
  linkCheckSummaryText,
  linkProcessingStateText,
  linkReportCountText,
  linkReportOutcomeText,
  readLinkHealth
} from '~/components/patch/resource/linkHealthDisplay'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import type { PatchResourceHealthLink } from '~/types/api/patch'
import type { LinkCheckSummary } from '~/types/api/linkHealth'

const healthLink = (
  overrides: Partial<PatchResourceHealthLink> = {}
): PatchResourceHealthLink => ({
  id: 21,
  storage: 'user',
  size: '2 GB',
  hash: '',
  sortOrder: 1,
  download: 0,
  version: 3,
  evidenceRound: 1,
  health: 'ok',
  healthChangedAt: null,
  verifiedAt: null,
  lastRelinkAt: null,
  ownerType: 'publisher',
  disputeSource: null,
  recentReportCount: 0,
  latestCheck: null,
  capabilities: {
    ownerActions: [],
    resolveActions: [],
    canCheck: false,
    canEdit: false
  },
  ...overrides
})

const check = (overrides: Partial<LinkCheckSummary>): LinkCheckSummary =>
  ({
    verdict: 'available',
    provider: 'quark',
    reason: 'share_available',
    failed: false,
    checkedAt: '2026-10-09T00:00:00.000Z',
    attemptedAt: '2026-10-09T00:00:00.000Z',
    stale: false,
    ...overrides
  }) as LinkCheckSummary

describe('readLinkHealth', () => {
  it('returns null for legacy links without health fields', () => {
    expect(
      readLinkHealth({
        id: 1,
        storage: 'user',
        size: '1 GB',
        hash: '',
        sortOrder: 1,
        download: 0
      })
    ).toBeNull()
  })

  it('returns the link when health fields are present', () => {
    expect(readLinkHealth(healthLink())?.version).toBe(3)
  })
})

describe('linkProcessingStateText', () => {
  it('is empty for ok links', () => {
    expect(linkProcessingStateText(healthLink())).toBe('')
  })

  it('describes suspect without naming the handler identity choice', () => {
    expect(linkProcessingStateText(healthLink({ health: 'suspect' }))).toBe(
      '疑似失效，等待归属方处理'
    )
    expect(
      linkProcessingStateText(
        healthLink({ health: 'suspect', ownerType: 'staff' })
      )
    ).toBe('疑似失效，等待站方处理')
  })

  it('describes owner-verification disputes by owner type', () => {
    expect(
      linkProcessingStateText(
        healthLink({
          health: 'disputed',
          disputeSource: 'owner_verification',
          ownerType: 'publisher'
        })
      )
    ).toBe('发布者称可用，多名用户称失效 · 等待复核')
    expect(
      linkProcessingStateText(
        healthLink({
          health: 'disputed',
          disputeSource: 'owner_verification',
          ownerType: 'staff'
        })
      )
    ).toBe('站方称可用，多名用户称失效 · 等待复核')
  })

  it('describes machine/user conflicts without merging the two facts', () => {
    expect(
      linkProcessingStateText(
        healthLink({
          health: 'disputed',
          disputeSource: 'machine_user_conflict',
          ownerType: 'staff'
        })
      )
    ).toBe('检测端可访问，但有用户反馈异常 · 等待复核')
  })
})

describe('linkCheckSummaryText', () => {
  it('marks unchecked, failed, stale and fresh results separately', () => {
    expect(linkCheckSummaryText(null)).toBe('机器检测：未检测')
    expect(
      linkCheckSummaryText(
        check({
          failed: true,
          checkedAt: null,
          verdict: 'unknown',
          provider: null,
          reason: 'timeout'
        })
      )
    ).toBe('机器检测：无法判断 / 检测失败')
    expect(
      linkCheckSummaryText(check({ stale: true }))
    ).toContain('结果已过期')
    expect(linkCheckSummaryText(check({}))).toContain('检测端可访问')
    expect(
      linkCheckSummaryText(
        check({ verdict: 'broken', reason: 'share_deleted' })
      )
    ).toContain('检测确认失效')
    expect(
      linkCheckSummaryText(
        check({ verdict: 'unknown', reason: 'rate_limited' })
      )
    ).toContain('无法判断')
  })
})

describe('fold helpers', () => {
  const links = [
    healthLink({ id: 1, health: 'broken' }),
    healthLink({
      id: 2,
      health: 'broken',
      lastRelinkAt: '2026-10-01T00:00:00.000Z'
    }),
    healthLink({ id: 3, health: 'ok' })
  ]

  it('counts broken links and takes the latest relink instant', () => {
    expect(countBrokenLinks(links)).toBe(2)
    expect(latestRelinkAt(links)).toBe('2026-10-01T00:00:00.000Z')
  })

  it('builds the resource-level fold line', () => {
    expect(brokenLinksFoldText(0, null)).toBeNull()
    expect(brokenLinksFoldText(2, null)).toBe('2 条链接已失效')
    expect(
      brokenLinksFoldText(2, '2026-10-01T00:00:00.000Z')
    ).toContain('2 条链接已失效 · 最近补链')
    expect(
      brokenLinksFoldText(2, '2026-10-01T00:00:00.000Z')
    ).not.toContain('已折叠')
  })
})

describe('target and basis construction', () => {
  it('builds target and basis from health fields', () => {
    const link = healthLink({
      version: 5,
      evidenceRound: 2,
      health: 'suspect',
      healthChangedAt: '2026-10-08T00:00:00.000Z'
    })
    expect(buildLinkTarget(7, 11, link)).toEqual({
      patchId: 7,
      resourceId: 11,
      linkId: 21,
      linkVersion: 5
    })
    expect(buildLinkBasis(7, 11, link)).toEqual({
      patchId: 7,
      resourceId: 11,
      linkId: 21,
      linkVersion: 5,
      evidenceRound: 2,
      health: 'suspect',
      healthChangedAt: '2026-10-08T00:00:00.000Z'
    })
  })

  it('returns null for legacy links (missing version)', () => {
    const legacy = {
      id: 9,
      storage: 'user',
      size: '1 GB',
      hash: '',
      sortOrder: 1,
      download: 0
    }
    expect(buildLinkTarget(7, 11, legacy)).toBeNull()
    expect(buildLinkBasis(7, 11, legacy)).toBeNull()
  })
})

describe('named conflict vocabulary', () => {
  it('recognizes only the 409 messages', () => {
    expect(
      isLinkConflictError(LINK_HEALTH_ERRORS.version_conflict.message)
    ).toBe(true)
    expect(isLinkConflictError(LINK_HEALTH_ERRORS.state_conflict.message)).toBe(
      true
    )
    expect(
      isLinkConflictError(LINK_HEALTH_ERRORS.resource_conflict.message)
    ).toBe(true)
    expect(
      isLinkConflictError(LINK_HEALTH_ERRORS.verification_cooldown.message)
    ).toBe(true)
    expect(
      isLinkConflictError(LINK_HEALTH_ERRORS.acquisition_required.message)
    ).toBe(false)
    expect(isLinkConflictError('网络错误')).toBe(false)
  })
})

describe('report outcome copy', () => {
  it('never claims a case exists when caseId is null', () => {
    expect(linkReportOutcomeText('recorded', null)).toContain('已记录一次报告')
    expect(linkReportOutcomeText('recorded', null)).not.toContain('归属方处理')
    expect(linkReportOutcomeText('renewed', null)).toContain('已更新你的报告')
    expect(linkReportOutcomeText('duplicate', null)).toContain('不会重复计数')
  })

  it('mentions the owner handoff only when a case exists', () => {
    expect(linkReportOutcomeText('recorded', 123)).toContain(
      '已交给其归属方处理'
    )
  })

  it('counts are plain user-facing text', () => {
    expect(linkReportCountText(0)).toBe('近期无人报告问题')
    expect(linkReportCountText(3)).toBe('近期 3 人报告问题')
  })
})
