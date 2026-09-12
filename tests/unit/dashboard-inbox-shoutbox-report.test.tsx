import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/components/dashboard/ui/badge', () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('~/components/dashboard/ui/button', () => ({
  Button: ({
    children,
    asChild
  }: {
    children?: React.ReactNode
    asChild?: boolean
  }) => (asChild ? <>{children}</> : <button>{children}</button>)
}))

vi.mock('~/components/dashboard/ui/separator', () => ({
  Separator: () => <hr />
}))

import { LegacyInboxDetail } from '~/components/dashboard/inbox/LegacyInboxDetail'
import type { InboxItem } from '~/types/api/inbox'

type LegacyReportItem = Extract<InboxItem, { kind: 'feedback' | 'report' }>

const user = (id: number, name: string) => ({ id, name, avatar: '' })

const baseItem = {
  kind: 'report' as const,
  title: '',
  subtitle: '',
  actor: null,
  waitingFrom: '2026-09-12T08:00:00.000Z',
  waitingSeconds: 0,
  badges: [],
  readOnly: false
}

const shoutboxItem: LegacyReportItem = {
  ...baseItem,
  key: 'report:9001',
  id: 9001,
  targetHref: '/dashboard/shoutbox?tab=pending_review',
  payload: {
    id: 9001,
    targetType: 'shoutbox',
    status: 0,
    reason: '涉嫌广告刷屏',
    handlerReply: '',
    patch: null,
    shoutbox: {
      id: 60,
      content: '低价代充，私聊联系',
      official: false,
      level: 'normal',
      status: 2,
      cost: 50,
      created: '2026-09-12T07:00:00.000Z',
      hiddenAt: '2026-09-12T07:30:00.000Z',
      refundedAt: null
    },
    comment: null,
    rating: null,
    sender: user(300, '举报人甲'),
    reportedUser: user(200, '消息作者乙'),
    created: '2026-09-12T08:00:00.000Z',
    handledAt: null,
    pendingForTarget: 2
  }
}

const commentReportItem: LegacyReportItem = {
  ...baseItem,
  key: 'report:8001',
  id: 8001,
  targetHref: '/admin/report',
  payload: {
    id: 8001,
    targetType: 'comment',
    status: 0,
    reason: '评论辱骂',
    handlerReply: '',
    patch: { id: 100, uniqueId: 'abcd1234', name: '示例游戏' },
    comment: { id: 55, content: '被骂的那条评论' },
    rating: null,
    sender: user(300, '举报人甲'),
    reportedUser: user(400, '评论作者丙'),
    created: '2026-09-12T08:00:00.000Z',
    handledAt: null,
    pendingForTarget: 0
  }
}

describe('LegacyInboxDetail shoutbox branch', () => {
  let dom: JSDOM | undefined
  let root: Root | undefined
  let container: HTMLElement

  const renderDetail = async (item: LegacyReportItem) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard/inbox'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<LegacyInboxDetail item={item} />)
      await Promise.resolve()
    })
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('renders the shoutbox report with message content, author, reporter, status and nullable patch', async () => {
    await renderDetail(shoutboxItem)

    const text = container.textContent ?? ''
    expect(text).toContain('小喇叭举报 #9001')
    expect(text).toContain('低价代充，私聊联系')
    expect(text).toContain('举报人甲')
    expect(text).toContain('消息作者乙')
    expect(text).toContain('涉嫌广告刷屏')
    expect(text).toContain('隐藏待复核')
    expect(text).toContain('同目标其他待处理举报 2 条')
    // No associated game: the patch field renders as empty, not a crash.
    expect(text).toContain('关联作品')
    // The entry point goes to the console review page via targetHref, and is
    // not framed as legacy data requiring the old backend.
    expect(container.querySelector('a[href="/dashboard/shoutbox?tab=pending_review"]')?.textContent).toBe('前往小喇叭复核')
    expect(text).not.toContain('去旧后台处理')
    expect(text).not.toContain('超级管理员')
  })

  it('keeps the legacy comment report branch unchanged', async () => {
    await renderDetail(commentReportItem)

    const text = container.textContent ?? ''
    expect(text).toContain('评论举报 #8001')
    expect(text).toContain('被骂的那条评论')
    expect(text).toContain('评论辱骂')
    expect(
      container.querySelector('a[href="/abcd1234"]')?.textContent
    ).toContain('示例游戏')
    expect(container.querySelector('a[href="/admin/report"]')?.textContent).toBe(
      '去旧后台处理'
    )
  })
})
