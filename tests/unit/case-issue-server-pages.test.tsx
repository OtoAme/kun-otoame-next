import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  notFound: vi.fn()
}))

vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children?: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

// 子组件是 client 边界；这里只验证服务端路由的鉴权、metadata 与接线
vi.mock('~/components/dashboard/issue/IssueWorkspace', () => ({
  IssueWorkspace: () => <div data-testid="issue-workspace" />
}))
vi.mock('~/components/dashboard/issue/IssueCaseDetail', () => ({
  IssueCaseDetail: ({ caseId }: { caseId: number }) => (
    <div data-testid="issue-case-detail" data-case-id={caseId} />
  )
}))
vi.mock('~/components/dashboard/issue/IssueLoginNotice', () => ({
  IssueLoginNotice: () => <div data-testid="issue-login-notice" />
}))
vi.mock('~/components/dashboard/issue/IssueHeader', () => ({
  IssueHeader: ({ user }: { user: { id: number; name: string } | null }) => (
    <header data-testid="issue-header" data-user={user ? user.name : ''} />
  )
}))

describe('issue server routes', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const renderElement = async (element: React.ReactElement) => {
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
      root!.render(element)
    })
    return container
  }

  it('keeps the private title out of the dashboard title template', async () => {
    const { metadata } = await import('~/app/(dashboard)/issue/layout')
    // 父级 (dashboard) 根布局的模板是「%s - OtoAme 管理后台」，用户侧必须跳过它
    expect(metadata.title).toEqual({ absolute: '问题处理' })
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
  })

  it('role 1 user reaches the issue pages through the layout', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 1, name: 'u', role: 1 })
    const { default: IssueLayout } = await import(
      '~/app/(dashboard)/issue/layout'
    )
    const container = await renderElement(
      await IssueLayout({ children: <div data-testid="issue-children" /> })
    )
    expect(
      container.querySelector('[data-testid="issue-children"]')
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="issue-login-notice"]')
    ).toBeNull()
    // 用户侧自有顶栏，拿到的是登录用户而不是后台的 role >= 3 用户
    expect(
      container
        .querySelector('[data-testid="issue-header"]')
        ?.getAttribute('data-user')
    ).toBe('u')
  })

  it('anonymous visitor gets the login guidance instead of an error', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue(null)
    const { default: IssueLayout } = await import(
      '~/app/(dashboard)/issue/layout'
    )
    const container = await renderElement(
      await IssueLayout({ children: <div data-testid="issue-children" /> })
    )
    expect(
      container.querySelector('[data-testid="issue-login-notice"]')
    ).not.toBeNull()
    expect(container.querySelector('[data-testid="issue-children"]')).toBeNull()
    // 顶栏仍然渲染，只是没有用户
    expect(
      container
        .querySelector('[data-testid="issue-header"]')
        ?.getAttribute('data-user')
    ).toBe('')
  })

  it('list page renders the workspace', async () => {
    const { default: IssuePage } = await import('~/app/(dashboard)/issue/page')
    const container = await renderElement(IssuePage())
    expect(
      container.querySelector('[data-testid="issue-workspace"]')
    ).not.toBeNull()
  })

  it('detail page passes the parsed id to the detail component', async () => {
    const { default: IssueDetailPage } = await import(
      '~/app/(dashboard)/issue/[id]/page'
    )
    const container = await renderElement(
      await IssueDetailPage({ params: Promise.resolve({ id: '5' }) })
    )
    const detail = container.querySelector('[data-testid="issue-case-detail"]')
    expect(detail).not.toBeNull()
    expect(detail!.getAttribute('data-case-id')).toBe('5')
    // 深链回列表用的是 /issue，工作区内选中另走 /issue?id=N
    expect(container.querySelector('a[href="/issue"]')).not.toBeNull()
  })

  it('invalid detail id triggers notFound', async () => {
    mocks.notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND')
    })
    const { default: IssueDetailPage } = await import(
      '~/app/(dashboard)/issue/[id]/page'
    )
    await expect(
      IssueDetailPage({ params: Promise.resolve({ id: 'abc' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
