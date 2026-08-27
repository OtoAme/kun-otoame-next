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
    onPress,
    isDisabled
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
  }) => (
    <button type="button" disabled={isDisabled} onClick={onPress}>
      {children}
    </button>
  ),
  Card: ({ children }: { children?: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children?: React.ReactNode }) => (
    <header>{children}</header>
  ),
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Divider: () => <hr />,
  Modal: ({
    children,
    isOpen
  }: {
    children?: React.ReactNode
    isOpen?: boolean
  }) => (isOpen ? <div data-testid="review-modal">{children}</div> : null),
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
  duplicateConfirmed: false
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

  const approveAndConfirm = async () => {
    await act(async () => {
      root.render(
        <AdminSubmissionDetail
          submission={submission}
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
