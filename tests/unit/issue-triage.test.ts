import { describe, expect, it } from 'vitest'
import {
  enabledIssueTriagePhenomena,
  ISSUE_TRIAGE_PHENOMENA,
  LINK_PHENOMENON_HANDLER_NOTE,
  REQUEST_RESOURCE_GUIDE_LINKS,
  REQUEST_RESOURCE_GUIDE_NOTE
} from '~/constants/issueTriage'
import { LINK_REPORT_REASONS } from '~/constants/linkHealth'

describe('issue triage phenomenon table (module 05)', () => {
  it('every row has exactly one destination and a unique key', () => {
    const keys = new Set<string>()
    for (const row of ISSUE_TRIAGE_PHENOMENA) {
      expect(keys.has(row.key)).toBe(false)
      keys.add(row.key)
      expect(row.targets.length).toBeGreaterThan(0)
      expect(['link_report', 'case', 'guide']).toContain(row.destination.type)
      if (row.destination.type === 'case') {
        expect(typeof row.destination.kind).toBe('string')
      }
      if (row.destination.type === 'link_report') {
        expect(LINK_REPORT_REASONS).toContain(row.destination.reason)
      }
      if (row.destination.type === 'guide') {
        expect(row.destination.links.length).toBeGreaterThan(0)
      }
    }
  })

  it('link targets use only the three report reasons, never a case kind', () => {
    const linkRows = enabledIssueTriagePhenomena('link')
    const reportRows = linkRows.filter(
      (row) => row.destination.type === 'link_report'
    )
    expect(reportRows.map((row) => row.destination)).toEqual([
      { type: 'link_report', reason: 'deleted' },
      { type: 'link_report', reason: 'access_condition' },
      { type: 'link_report', reason: 'unreachable' }
    ])
    // The interim resource_link_failure case kind is retired from the entry.
    expect(
      linkRows.some(
        (row) =>
          row.destination.type === 'case' &&
          row.destination.kind === 'resource_link_failure'
      )
    ).toBe(false)
    // 弱证据通往 unreachable 一行，由 04 在服务端校验 networkAcknowledged。
    const weak = reportRows.find(
      (row) =>
        row.destination.type === 'link_report' &&
        row.destination.reason === 'unreachable'
    )
    expect(weak?.key).toBe('link_unreachable')
  })

  it('download_slow is a guide-only destination on both targets', () => {
    for (const target of ['link', 'resource'] as const) {
      const slow = enabledIssueTriagePhenomena(target).find(
        (row) => row.key === 'download_slow'
      )
      expect(slow?.destination.type).toBe('guide')
    }
  })

  it('keeps the D40 rows submittable with their guides', () => {
    const resourceRows = enabledIssueTriagePhenomena('resource')
    const runtime = resourceRows.find((row) => row.key === 'archive_or_runtime')
    const request = resourceRows.find((row) => row.key === 'request_resource')
    const other = resourceRows.find((row) => row.key === 'resource_other')

    expect(
      runtime?.destination.type === 'case' && runtime.destination.kind
    ).toBe('resource_runtime')
    expect(
      runtime?.destination.type === 'case' && runtime.destination.guide?.note
    ).toBeTruthy()
    expect(
      request?.destination.type === 'case' && request.destination.kind
    ).toBe('resource_request')
    expect(
      request?.destination.type === 'case' &&
        request.destination.guide?.links
    ).toEqual(REQUEST_RESOURCE_GUIDE_LINKS)
    expect(
      other?.destination.type === 'case' && other.destination.kind
    ).toBe('resource_other')
    expect(REQUEST_RESOURCE_GUIDE_NOTE).toContain('内容贡献指南')
  })

  it('keeps wrong_patch a staff-handled case and enables the violation branch', () => {
    const resourceRows = enabledIssueTriagePhenomena('resource')
    const wrongPatch = resourceRows.find((row) => row.key === 'wrong_patch')
    const violation = resourceRows.find((row) => row.key === 'violation')

    expect(
      wrongPatch?.destination.type === 'case' && wrongPatch.destination.kind
    ).toBe('resource_wrong_patch')
    expect(violation?.enabled).toBe(true)
    expect(
      violation?.destination.type === 'case' && violation.destination.kind
    ).toBe('content_violation')
    // 违规举报只针对整条资源，不针对单条链接。
    expect(
      enabledIssueTriagePhenomena('link').some((row) => row.key === 'violation')
    ).toBe(false)
  })

  it('link rows carry the shared handler-scope note without naming a person', () => {
    for (const row of enabledIssueTriagePhenomena('link')) {
      if (row.destination.type !== 'link_report') continue
      expect(row.handlerHint).toBe(LINK_PHENOMENON_HANDLER_NOTE)
      expect(row.handlerHint).toContain('归属方')
      expect(row.handlerHint).not.toContain('资源发布者，')
    }
  })

  it('target filtering keeps both lists non-empty and disjoint where required', () => {
    const linkRows = enabledIssueTriagePhenomena('link')
    const resourceRows = enabledIssueTriagePhenomena('resource')
    expect(linkRows.length).toBeGreaterThan(0)
    expect(resourceRows.length).toBeGreaterThan(0)
    const linkKeys = new Set(linkRows.map((row) => row.key))
    for (const row of resourceRows) {
      if (row.key === 'download_slow') continue
      expect(linkKeys.has(row.key)).toBe(false)
    }
    // 未传目标时返回全部启用行（旧调用兼容）。
    expect(enabledIssueTriagePhenomena().length).toBe(
      ISSUE_TRIAGE_PHENOMENA.filter((row) => row.enabled).length
    )
  })
})
