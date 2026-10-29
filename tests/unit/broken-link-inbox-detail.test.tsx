import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children?: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

import { BrokenLinkInboxDetail } from '~/components/dashboard/inbox/BrokenLinkInboxDetail'
import type { BrokenLinkInboxItem } from '~/types/api/inbox'

globalThis.React = React

const item = (remove: boolean): BrokenLinkInboxItem => ({
  key: 'broken-link:21',
  kind: 'broken-link',
  id: 21,
  title: '资源X 的站内资源盘链接已失效',
  subtitle: '条目A',
  actor: null,
  waitingFrom: '2026-10-08T00:00:00.000Z',
  waitingSeconds: 86400,
  targetHref: '/admin/resource/link/7?linkId=21',
  badges: ['已失效'],
  readOnly: false,
  payload: {
    link: {
      patchId: 3,
      resourceId: 7,
      linkId: 21,
      version: 2,
      evidenceRound: 1,
      health: 'broken',
      healthChangedAt: '2026-10-08T00:00:00.000Z',
      verifiedAt: null,
      lastRelinkAt: null,
      ownerType: 'staff',
      disputeSource: null,
      recentReportCount: 4,
      latestCheck: null,
      capabilities: {
        ownerActions: [],
        resolveActions: [],
        canCheck: false,
        canEdit: true
      },
      patch: { uniqueId: 'abc12345', name: '条目A' },
      resource: { name: '资源X', section: 'galgame' },
      storage: 'touchgal',
      size: '2 GB',
      hostname: 'pan.touchgal.example.com',
      brokenForSeconds: 172800,
      caseId: null
    },
    actions: { relink: true, remove }
  }
})

describe('BrokenLinkInboxDetail (broken-link inbox)', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async (ui: React.ReactElement) => {
    act(() => {
      root?.unmount()
    })
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    return container
  }

  it('renders the redacted payload and one edit action to the authorized editor', async () => {
    const container = await mount(
      <BrokenLinkInboxDetail item={item(true)} onProcessed={vi.fn()} />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('条目A')
    expect(text).toContain('资源X')
    expect(text).toContain('pan.touchgal.example.com')
    expect(text).toContain('已失效 2 天')
    expect(text).toContain('改到新地址，或删除这条链接')

    // 补链与移除在同一个受权编辑路径里完成（资源 id+链接 id 定位）
    const editLinks = [
      ...container.querySelectorAll(
        'a[href="/admin/resource/link/7?linkId=21"]'
      )
    ]
    expect(editLinks.map((link) => link.textContent)).toEqual(['编辑链接'])
    // 查看链接定位到前台资源页的这条资源（含 & 的 href 不作为 CSS 选择器）
    const viewLink = [...container.querySelectorAll('a')].find((anchor) =>
      anchor.textContent?.includes('查看资源')
    )
    expect(viewLink?.getAttribute('href')).toBe(
      '/abc12345?tab=resources&resourceSection=galgame&resourceId=7'
    )
    expect(container.querySelector('button[disabled]')).toBeNull()
  })

  it('says the last remaining link can only be changed, not removed', async () => {
    const container = await mount(
      <BrokenLinkInboxDetail item={item(false)} onProcessed={vi.fn()} />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('最后一条链接，只能改地址，不能删除')
    const links = [
      ...container.querySelectorAll(
        'a[href="/admin/resource/link/7?linkId=21"]'
      )
    ]
    expect(links.length).toBe(1)
  })
})
