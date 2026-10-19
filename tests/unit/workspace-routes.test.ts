import { describe, expect, it } from 'vitest'
import {
  parseWorkspaceIssueNotification,
  workspaceIssueHref,
  workspaceIssueRedirect,
  workspaceResourceHref
} from '~/utils/workspaceRoutes'

describe('workspace routes', () => {
  it('recognizes only exact old and new issue notification destinations', () => {
    expect(parseWorkspaceIssueNotification('/issue/42')).toBe(42)
    expect(parseWorkspaceIssueNotification('/workspace/issues/42')).toBe(42)
    for (const invalid of [
      '/issue/0',
      '/issue/01',
      '/issue/1x',
      '/issue/1/reply',
      '/issue/1?x=2',
      '/issue/1#x',
      '/issue/2147483648',
      'https://example.com/issue/1',
      '/workspace/issues/NaN'
    ]) {
      expect(parseWorkspaceIssueNotification(invalid)).toBeNull()
    }
  })

  it('keeps valid issue selection and pagination while rejecting injected query values', () => {
    expect(
      workspaceIssueRedirect({
        tab: 'owned',
        status: 'processing',
        page: '3',
        id: '42',
        next: '//elsewhere'
      })
    ).toBe('/workspace/issues?tab=owned&status=processing&page=3&id=42')
    expect(
      workspaceIssueRedirect(
        {
          tab: ['owned', 'reported'],
          status: 'unknown',
          page: '-1',
          id: '1e2'
        },
        42
      )
    ).toBe('/workspace/issues/42')
  })

  it('builds owner and reader destinations separately', () => {
    expect(workspaceResourceHref(5, 7)).toBe('/workspace/resources/5?linkId=7')
    expect(workspaceIssueHref(7)).toBe('/workspace/issues/7')
  })
})
