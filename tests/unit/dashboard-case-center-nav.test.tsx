import React from 'react'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CaseCenterNav } from '~/components/dashboard/case/CaseCenterNav'
import {
  DEFAULT_CASE_VIEW,
  findCaseView
} from '~/components/dashboard/case/caseCenterViews'
import type { CaseStatusCounts } from '~/types/api/case'

globalThis.React = React

const COUNTS: CaseStatusCounts = {
  open: 3,
  waiting_owner: 1,
  waiting_reporter: 2,
  resolved: 4,
  rejected: 1,
  merged: 0
}

const renderStrip = (brokenLinkCount: number | null = 2) =>
  new JSDOM(
    renderToStaticMarkup(
      <CaseCenterNav
        current={DEFAULT_CASE_VIEW}
        statusCounts={COUNTS}
        brokenLinkCount={brokenLinkCount}
        onSelect={vi.fn()}
      />
    )
  ).window.document

describe('issue page navigation', () => {
  it('groups the staff to-dos apart from the read-only lists', () => {
    const doc = renderStrip()
    const groups = [...doc.querySelectorAll('ul[aria-label]')].map((list) => [
      list.getAttribute('aria-label'),
      [...list.querySelectorAll('[data-case-view]')].map((entry) =>
        entry.getAttribute('data-case-view')
      )
    ])
    expect(groups).toEqual([
      ['待办', ['pending', 'waiting_reporter', 'broken-link']],
      ['查看', ['publisher', 'closed', 'all']]
    ])
    // One strip at every width, never a side column.
    expect(doc.querySelectorAll('[data-case-nav]')).toHaveLength(1)
  })

  it('counts each entry from its own statuses and the shell link count', () => {
    const doc = renderStrip()
    const text = (view: string) =>
      doc.querySelector(`[data-case-view="${view}"]`)?.textContent
    // 待处理 = open + waiting_owner；已结案 = resolved + rejected
    expect(text('pending')).toBe('待处理4')
    expect(text('waiting_reporter')).toBe('等待报告者2')
    expect(text('broken-link')).toBe('资源盘链接失效2')
    expect(text('closed')).toBe('已结案5')
    expect(text('all')).toBe('全部11')
    // Publisher-owned counts are not in hand, so that entry has no number.
    expect(text('publisher')).toBe('发布者处理中')
  })

  it('keeps the staff scope behind a help button', () => {
    const doc = renderStrip()
    expect(doc.querySelector('[aria-label="站方处理哪些问题"]')).not.toBeNull()
  })

  it('maps views from older links onto the current ones', () => {
    expect(findCaseView('overview').value).toBe('pending')
    expect(findCaseView('unresolved').value).toBe('pending')
    expect(findCaseView('resolved').value).toBe('closed')
    expect(findCaseView('rejected').value).toBe('closed')
    expect(findCaseView('nonsense').value).toBe('pending')
  })
})
