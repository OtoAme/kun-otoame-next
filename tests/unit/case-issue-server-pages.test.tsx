import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
}))

vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  usePathname: () => '/workspace/resources',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
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

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt?: string; src: string }) => (
    <img alt={alt ?? ''} src={src} />
  )
}))

vi.mock('~/components/dashboard/issue/IssueWorkspace', () => ({
  IssueWorkspace: () => <div data-testid="issue-workspace" />
}))
vi.mock('~/components/dashboard/issue/IssueCaseDetail', () => ({
  IssueCaseDetail: ({ caseId }: { caseId: number }) => (
    <div data-testid="issue-case-detail" data-case-id={caseId} />
  )
}))
vi.mock('~/components/dashboard/workspace/WorkspaceShell', () => ({
  WorkspaceShell: ({
    user,
    children
  }: {
    user: { id: number; name: string }
    children?: React.ReactNode
  }) => (
    <div data-testid="workspace-shell" data-user={user.name} data-id={user.id}>
      {children}
    </div>
  )
}))

describe('issue and workspace server routes', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND')
    })
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`)
    })
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

  const renderElement = async (element: React.ReactNode) => {
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
    const issue = await import('~/app/(dashboard)/issue/layout')
    const workspace = await import('~/app/(dashboard)/workspace/layout')
    expect(issue.metadata.title).toEqual({ absolute: '问题处理' })
    expect(workspace.metadata.title).toEqual({ absolute: '用户工作台' })
    expect(issue.metadata.robots).toMatchObject({ index: false, follow: false })
    expect(workspace.metadata.robots).toMatchObject({
      index: false,
      follow: false
    })
  })

  it('lets the old issue layout render children without an admin gate', async () => {
    const { default: IssueLayout } = await import(
      '~/app/(dashboard)/issue/layout'
    )
    const container = await renderElement(
      IssueLayout({ children: <div data-testid="issue-children" /> })
    )
    expect(
      container.querySelector('[data-testid="issue-children"]')
    ).not.toBeNull()
    expect(mocks.verifyHeaderCookie).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('管理后台')
  })

  it('redirects the old issue list through the query whitelist', async () => {
    const { default: IssuePage } = await import('~/app/(dashboard)/issue/page')
    await expect(
      IssuePage({
        searchParams: Promise.resolve({
          tab: 'owned',
          status: 'not-a-status',
          page: '2',
          id: '01',
          extra: 'drop'
        })
      })
    ).rejects.toThrow('REDIRECT:/workspace/issues?tab=owned&page=2')
  })

  it('redirects a valid issue detail and rejects an invalid id', async () => {
    const { default: IssueDetailPage } = await import(
      '~/app/(dashboard)/issue/[id]/page'
    )
    await expect(
      IssueDetailPage({
        params: Promise.resolve({ id: '5' }),
        searchParams: Promise.resolve({ tab: 'reported', id: '9' })
      })
    ).rejects.toThrow('REDIRECT:/workspace/issues/5?tab=reported&id=9')
    await expect(
      IssueDetailPage({
        params: Promise.resolve({ id: 'abc' }),
        searchParams: Promise.resolve({})
      })
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('sends /workspace to the resource list', async () => {
    const { default: WorkspaceIndex } = await import(
      '~/app/(dashboard)/workspace/page'
    )
    expect(() => WorkspaceIndex()).toThrow('REDIRECT:/workspace/resources')
  })

  it('loads the signed-in user into the workspace shell', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({
      uid: 4,
      name: '作者',
      role: 1
    })
    const { default: WorkspaceLayout } = await import(
      '~/app/(dashboard)/workspace/layout'
    )
    const container = await renderElement(
      await WorkspaceLayout({
        children: <div data-testid="workspace-children" />
      })
    )
    const shell = container.querySelector('[data-testid="workspace-shell"]')
    expect(shell?.getAttribute('data-user')).toBe('作者')
    expect(shell?.getAttribute('data-id')).toBe('4')
    expect(
      container.querySelector('[data-testid="workspace-children"]')
    ).not.toBeNull()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('sends an anonymous workspace visitor to login', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue(null)
    const { default: WorkspaceLayout } = await import(
      '~/app/(dashboard)/workspace/layout'
    )
    await expect(
      WorkspaceLayout({ children: <div data-testid="workspace-children" /> })
    ).rejects.toThrow('REDIRECT:/login')
  })

  it('mounts issue handling under the workspace and keeps the detail id', async () => {
    const { default: IssuesPage } = await import(
      '~/app/(dashboard)/workspace/issues/page'
    )
    const list = await renderElement(IssuesPage())
    expect(list.querySelector('[data-testid="issue-workspace"]')).not.toBeNull()

    act(() => {
      root?.unmount()
    })
    root = undefined
    const { default: DetailPage } = await import(
      '~/app/(dashboard)/workspace/issues/[id]/page'
    )
    const detail = await renderElement(
      await DetailPage({ params: Promise.resolve({ id: '8' }) })
    )
    expect(
      detail.querySelector('[data-testid="issue-case-detail"]')?.getAttribute(
        'data-case-id'
      )
    ).toBe('8')
    expect(detail.querySelector('a[href="/workspace/issues"]')).not.toBeNull()
    await expect(
      DetailPage({ params: Promise.resolve({ id: '0' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
