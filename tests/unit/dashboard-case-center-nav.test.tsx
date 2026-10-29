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

/** The column is the orientation that shows group titles. */
const renderColumn = (brokenLinkCount: number | null = 2) =>
  new JSDOM(
    renderToStaticMarkup(
      <CaseCenterNav
        current={DEFAULT_CASE_VIEW}
        statusCounts={COUNTS}
        brokenLinkCount={brokenLinkCount}
        orientation="vertical"
        onSelect={vi.fn()}
      />
    )
  ).window.document

describe('issue page navigation', () => {
  it('groups the staff to-dos apart from the read-only lists', () => {
    const doc = renderColumn()
    const groups = [...doc.querySelectorAll('ul[aria-labelledby]')].map(
      (list) => [
        doc.getElementById(list.getAttribute('aria-labelledby')!)?.textContent,
        [...list.querySelectorAll('[data-case-view]')].map((entry) =>
          entry.getAttribute('data-case-view')
        )
      ]
    )
    expect(groups).toEqual([
      ['待办', ['pending', 'waiting_reporter', 'broken-link']],
      ['查看', ['publisher', 'closed', 'all']]
    ])
  })

  it('counts each entry from its own statuses and the shell link count', () => {
    const doc = renderColumn()
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

  it('says which cases the staff handles', () => {
    const doc = renderColumn()
    const nav = doc.querySelector('nav[aria-label="问题处理导航"]')!
    const hint = doc.getElementById(
      nav.getAttribute('aria-describedby')!
    )!.textContent
    for (const part of [
      '违规举报',
      '条目资料有误',
      '资源发错条目',
      '站务反馈',
      '求资源或催更',
      '官方资源的问题',
      '发布者 7 天未处理',
      '报告者申请复核'
    ]) {
      expect(hint).toContain(part)
    }
  })

  it('maps views from older links onto the current ones', () => {
    expect(findCaseView('overview').value).toBe('pending')
    expect(findCaseView('unresolved').value).toBe('pending')
    expect(findCaseView('resolved').value).toBe('closed')
    expect(findCaseView('rejected').value).toBe('closed')
    expect(findCaseView('nonsense').value).toBe('pending')
  })
})
