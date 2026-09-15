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

// 子组件是 client 边界；这里只验证服务端页面鉴权与渲染接线
vi.mock('~/components/case/CaseTabsContainer', () => ({
  CaseTabsContainer: () => <div data-testid="case-tabs-container" />
}))
vi.mock('~/components/case/CaseDetailContainer', () => ({
  CaseDetailContainer: ({ caseId }: { caseId: number }) => (
    <div data-testid="case-detail-container" data-case-id={caseId} />
  )
}))
vi.mock('~/components/case/IssueLoginRequired', () => ({
  IssueLoginRequired: ({ title }: { title: string }) => (
    <div data-testid="issue-login-required">{title}</div>
  )
}))

describe('issue server pages', () => {
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

  it('role 1 user renders the issue list page', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 1, name: 'u', role: 1 })
    const { default: IssuePage } = await import('~/app/(site)/issue/page')
    const container = await renderElement(await IssuePage())
    expect(
      container.querySelector('[data-testid="case-tabs-container"]')
    ).not.toBeNull()
  })

  it('role 2 user renders the issue detail page', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 2, name: 'u', role: 2 })
    const { default: IssueDetailPage } = await import(
      '~/app/(site)/issue/[id]/page'
    )
    const container = await renderElement(
      await IssueDetailPage({ params: Promise.resolve({ id: '5' }) })
    )
    const detail = container.querySelector(
      '[data-testid="case-detail-container"]'
    )
    expect(detail).not.toBeNull()
    expect(detail!.getAttribute('data-case-id')).toBe('5')
  })

  it('anonymous visitor gets the login fallback on the list page', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue(null)
    const { default: IssuePage } = await import('~/app/(site)/issue/page')
    const container = await renderElement(await IssuePage())
    expect(
      container.querySelector('[data-testid="issue-login-required"]')
    ).not.toBeNull()
  })

  it('invalid detail id triggers notFound', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 1, name: 'u', role: 1 })
    mocks.notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND')
    })
    const { default: IssueDetailPage } = await import(
      '~/app/(site)/issue/[id]/page'
    )
    await expect(
      IssueDetailPage({ params: Promise.resolve({ id: 'abc' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
