import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchDelete: vi.fn()
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchDelete: fetchMock.kunFetchDelete
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => routerMock
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    isDisabled,
    isLoading,
    'aria-label': ariaLabel,
    onPress
  }: {
    children?: React.ReactNode
    isDisabled?: boolean
    isLoading?: boolean
    'aria-label'?: string
    onPress?: () => void
  }) => (
    <button
      aria-label={ariaLabel}
      disabled={isDisabled || isLoading}
      onClick={onPress}
    >
      {children}
    </button>
  )
}))

vi.mock('@heroui/modal', () => ({
  Modal: ({
    children,
    isOpen
  }: {
    children?: React.ReactNode
    isOpen?: boolean
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  useDisclosure: () => {
    const [isOpen, setIsOpen] = React.useState(false)
    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onClose: () => setIsOpen(false),
      onOpenChange: setIsOpen
    }
  }
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

describe('DeleteConversationButton', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderButton = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { DeleteConversationButton } = await import(
      '~/components/message/chat/DeleteConversationButton'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <DeleteConversationButton conversationId={5} otherUserName="Mio" />
      )
    })

    return { container: container! }
  }

  beforeEach(() => {
    fetchMock.kunFetchDelete.mockReset()
    routerMock.push.mockReset()
  })

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

  it('shows a retryable error and releases deleting state when removal throws', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()
    fetchMock.kunFetchDelete.mockRejectedValueOnce(new Error('network down'))

    const { container } = await renderButton()

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="移除该私聊"]')
        ?.click()
      await Promise.resolve()
    })

    const confirmButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent === '移除')
    expect(confirmButton).not.toBeNull()

    await act(async () => {
      confirmButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchDelete).toHaveBeenCalledWith(
      '/message/conversation/5',
      { action: 'conversation' }
    )
    expect(routerMock.push).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('移除私聊失败，请稍后重试')
    expect(confirmButton?.disabled).toBe(false)
  })
})
