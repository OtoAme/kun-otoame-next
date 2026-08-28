import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { AdminPatchSubmissionDetail } from '~/app/api/admin/patch-submission/service'

globalThis.React = React

const stateChangedMessage = '投稿已被撤回或处理, 请刷新后重试'

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@bprogress/next', () => ({ useRouter: () => routerMock }))

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('~/utils/kunFetch', () => ({ kunFetchPost: fetchMock }))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: toastMock }))

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children?: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

vi.mock('~/components/submission/PatchSubmissionPreviewView', () => ({
  PatchSubmissionPreviewView: () => <div data-testid="submission-preview" />
}))

vi.mock('@heroui/react', () => ({
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>,
  Button: ({
    children,
    href,
    target,
    onPress,
    isDisabled
  }: {
    children?: React.ReactNode
    href?: string
    target?: string
    onPress?: () => void
    isDisabled?: boolean
  }) =>
    href ? (
      <a href={href} target={target}>
        {children}
      </a>
    ) : (
      <button type="button" disabled={isDisabled} onClick={onPress}>
        {children}
      </button>
    ),
  Card: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => <section className={className}>{children}</section>,
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children?: React.ReactNode }) => (
    <header>{children}</header>
  ),
  Chip: ({
    children,
    color
  }: {
    children?: React.ReactNode
    color?: string
  }) => <span data-color={color}>{children}</span>,
  Divider: () => <hr />,
  Modal: ({
    children,
    isOpen,
    isDismissable,
    isKeyboardDismissDisabled,
    hideCloseButton
  }: {
    children?: React.ReactNode
    isOpen?: boolean
    isDismissable?: boolean
    isKeyboardDismissDisabled?: boolean
    hideCloseButton?: boolean
  }) =>
    isOpen ? (
      <div
        data-testid="review-modal"
        data-dismissable={String(isDismissable)}
        data-keyboard-dismiss-disabled={String(isKeyboardDismissDisabled)}
        data-hide-close-button={String(hideCloseButton)}
      >
        {children}
      </div>
    ) : null,
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <header>{children}</header>
  ),
  Switch: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Textarea: () => <textarea />
}))

import { AdminSubmissionDetail } from '~/components/admin/submission/AdminSubmissionDetail'

const submission: AdminPatchSubmissionDetail = {
  id: 1,
  status: 'pending',
  name: 'Withdrawn game',
  payloadVersion: 1,
  heldAmount: 10,
  roleAtCreation: 1,
  externalSource: null,
  externalFetchedAt: null,
  reviewReason: null,
  reviewedAt: null,
  reviewedBy: null,
  submittedAt: '2026-08-27T00:00:00.000Z',
  created: '2026-08-27T00:00:00.000Z',
  author: { id: 2, name: 'Author', avatar: '' },
  preview: null,
  vndbDuplicates: [],
  duplicatesTruncated: false,
  duplicateConfirmed: false,
  publishedPatch: null
}

describe('AdminSubmissionDetail stale review recovery', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue(stateChangedMessage)
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/admin/submission/1'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const openApprove = async (
    overrides: Partial<AdminPatchSubmissionDetail> = {}
  ) => {
    await act(async () => {
      root.render(
        <AdminSubmissionDetail
          submission={{ ...submission, ...overrides }}
          reviewerId={9}
          reviewerRole={3}
        />
      )
    })

    const buttons = [...dom.window.document.querySelectorAll('button')]
    const approve = buttons.find((button) => button.textContent === '通过')
    expect(approve).toBeDefined()

    await act(async () => {
      approve?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
    })
  }

  const approveAndConfirm = async () => {
    await openApprove()

    const confirm = [...dom.window.document.querySelectorAll('button')].find(
      (button) => button.textContent === '确认'
    )
    expect(confirm).toBeDefined()

    await act(async () => {
      confirm?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('closes the action modal and refreshes when the submission state changed', async () => {
    await approveAndConfirm()

    expect(toastMock.error).toHaveBeenCalledWith(stateChangedMessage)
    expect(routerMock.refresh).toHaveBeenCalledTimes(1)
    expect(
      dom.window.document.querySelector('[data-testid="review-modal"]')
    ).toBeNull()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('spells out the deposit refund and the publish reward before approving', async () => {
    await openApprove()

    const hint = dom.window.document.querySelector(
      '[data-testid="review-modal"]'
    )?.textContent

    expect(hint).toContain(`返还投稿人押金 ${submission.heldAmount} 萌萌点`)
    expect(hint).toContain('3 萌萌点投稿奖励')
  })

  it('promises no refund when the submission never held a deposit', async () => {
    await openApprove({ heldAmount: 0 })

    const hint = dom.window.document.querySelector(
      '[data-testid="review-modal"]'
    )?.textContent

    expect(hint).not.toContain('押金')
    expect(hint).toContain('3 萌萌点投稿奖励')
  })

  it('locks the modal down while the review request is in flight', async () => {
    let settleReview: (response: Record<string, unknown>) => void = () => {}
    fetchMock.mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          settleReview = resolve
        })
    )

    await approveAndConfirm()

    const modal = dom.window.document.querySelector(
      '[data-testid="review-modal"]'
    )
    expect(modal?.getAttribute('data-dismissable')).toBe('false')
    expect(modal?.getAttribute('data-keyboard-dismiss-disabled')).toBe('true')
    expect(modal?.getAttribute('data-hide-close-button')).toBe('true')

    const cancel = [...dom.window.document.querySelectorAll('button')].find(
      (button) => button.textContent === '取消'
    )
    expect(cancel?.disabled).toBe(true)

    // 让请求落地, 否则未决的 promise 会带着 working=true 漏进下一个用例。
    await act(async () => {
      settleReview({})
      await Promise.resolve()
    })
  })

  it('keeps the current review open for unrelated business errors', async () => {
    fetchMock.mockResolvedValue('该游戏的外部 ID 已被占用')

    await approveAndConfirm()

    expect(toastMock.error).toHaveBeenCalledWith('该游戏的外部 ID 已被占用')
    expect(routerMock.refresh).not.toHaveBeenCalled()
    expect(
      dom.window.document.querySelector('[data-testid="review-modal"]')
    ).not.toBeNull()
  })
})

describe('AdminSubmissionDetail duplicate panel', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/admin/submission/1'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const renderWith = async (overrides: Partial<AdminPatchSubmissionDetail>) => {
    await act(async () => {
      root.render(
        <AdminSubmissionDetail
          submission={{ ...submission, ...overrides }}
          reviewerId={9}
          reviewerRole={3}
        />
      )
    })
    return dom.window.document
  }

  const publishedLink = (document: Document) =>
    [...document.querySelectorAll('a')].find((anchor) =>
      anchor.textContent?.includes('已发布为')
    )

  it('warns about the collision while the submission is still pending', async () => {
    const document = await renderWith({
      status: 'pending',
      vndbDuplicates: [{ uniqueId: 'AAA', name: 'Other entry' }]
    })

    expect(document.querySelector('.border-warning-200')).not.toBeNull()
    expect(document.querySelector('[data-color="danger"]')).not.toBeNull()
    expect(document.body.textContent).toContain('VNDB ID 与现有条目重复')
  })

  it('demotes the collision to history once the submission is published', async () => {
    const document = await renderWith({
      status: 'published',
      vndbDuplicates: [{ uniqueId: 'AAA', name: 'Other entry' }],
      publishedPatch: { uniqueId: 'BBB', name: 'New entry' }
    })

    expect(document.querySelector('.border-warning-200')).toBeNull()
    expect(document.querySelector('[data-color="danger"]')).toBeNull()
    expect(document.querySelector('[data-color="default"]')).not.toBeNull()
    expect(document.body.textContent).toContain('共用此 VNDB ID 的其他条目')
    expect(publishedLink(document)?.getAttribute('href')).toBe('/BBB')
  })

  it('links to the published entry even when nothing else shares the id', async () => {
    const document = await renderWith({
      status: 'published',
      publishedPatch: { uniqueId: 'BBB', name: 'New entry' }
    })

    expect(document.body.textContent).not.toContain('共用此 VNDB ID 的其他条目')
    expect(publishedLink(document)?.getAttribute('href')).toBe('/BBB')
  })

  it('renders without a dead link once the published entry was deleted', async () => {
    const document = await renderWith({ status: 'published' })

    expect(publishedLink(document)).toBeUndefined()
    expect(document.body.textContent).toContain('投稿 #1')
  })

  it('says so when more entries share the id than the list shows', async () => {
    const document = await renderWith({
      status: 'published',
      vndbDuplicates: [{ uniqueId: 'AAA', name: 'Other entry' }],
      duplicatesTruncated: true
    })

    expect(document.body.textContent).toContain('仅列出前 10 条')
  })
})
