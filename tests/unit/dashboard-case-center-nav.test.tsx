import React from 'react'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CaseCenterNav } from '~/components/dashboard/case/CaseCenterNav'
import { DEFAULT_CASE_VIEW } from '~/components/dashboard/case/caseCenterViews'

globalThis.React = React

/** The column is the orientation that shows group titles. */
const renderColumn = () =>
  new JSDOM(
    renderToStaticMarkup(
      <CaseCenterNav
        current={DEFAULT_CASE_VIEW}
        statusCounts={null}
        orientation="vertical"
        onSelect={vi.fn()}
      />
    )
  ).window.document

describe('case center navigation owners', () => {
  it('names who handles each group inside the title that labels its list', () => {
    const doc = renderColumn()

    // 处理方写在分组标题里，标题又是该组列表的名称，读屏进入列表就一并读到
    const groups = [...doc.querySelectorAll('ul[aria-labelledby]')].map(
      (list) => [
        doc.getElementById(list.getAttribute('aria-labelledby')!)?.textContent,
        [...list.querySelectorAll('[data-case-view]')].map((entry) =>
          entry.getAttribute('data-case-view')
        )
      ]
    )
    expect(groups).toEqual([
      ['概览站方处理', ['overview']],
      ['未结站方处理', ['unresolved', 'pending', 'waiting_reporter']],
      ['已结案站方处理', ['resolved', 'rejected']],
      ['全部站方处理', ['all']],
      ['只读发布者处理', ['publisher']]
    ])
  })

  it('spells out under the navigation which cases the staff handles', () => {
    const doc = renderColumn()
    const nav = doc.querySelector('nav[aria-label="事项中心导航"]')!
    const hint = doc.getElementById(
      nav.getAttribute('aria-describedby')!
    )!.textContent

    // 原有的子集说明保留
    expect(hint).toContain('待处理与等待报告者是未结事项的两个子集')
    // 一开始就归站方的几类，以及发布者超时、报告者申请复核后转来的资源问题
    for (const part of [
      '违规举报',
      '条目资料有误',
      '资源发错条目',
      '站务反馈与条目页「其他」',
      '官方资源的问题',
      '发布者 7 天未处理',
      '报告者申请复核'
    ]) {
      expect(hint).toContain(part)
    }
    expect(hint).toContain('发布者处理中不在站方队列里')
  })
})
