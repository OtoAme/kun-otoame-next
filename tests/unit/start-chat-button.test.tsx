import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn()
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet,
  kunFetchPost: fetchMock.kunFetchPost
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isLoading,
    startContent
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isLoading?: boolean
    startContent?: React.ReactNode
  }) => (
    <button disabled={isLoading} onClick={onPress}>
      {startContent}
      {children}
    </button>
  ),
  Modal: ({
    children,
    isOpen
  }: {
    children?: React.ReactNode
    isOpen?: boolean
  }) => (isOpen ? <div>{children}</div> : null),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useDisclosure: () => {
    const [isOpen, setIsOpen] = React.useState(false)

    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onClose: () => setIsOpen(false)
    }
  }
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

describe('StartChatButton', () => {
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

    const { StartChatButton } = await import('~/components/user/StartChatButton')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<StartChatButton targetUserId={8} />)
    })

    return { container: container! }
  }

  beforeEach(() => {
    fetchMock.kunFetchGet.mockReset()
    fetchMock.kunFetchPost.mockReset()
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

  it('opens an existing conversation through POST so hidden chats become visible again', async () => {
    fetchMock.kunFetchGet.mockResolvedValueOnce({
      exists: true,
      conversationId: 5,
      needsPayment: false,
      targetUserName: 'Mio'
    })
    fetchMock.kunFetchPost.mockResolvedValueOnce({
      conversationId: 5,
      isNew: false
    })

    const { container } = await renderButton()

    await act(async () => {
      container.querySelector('button')?.click()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation',
      { targetUserId: 8 }
    )
    expect(routerMock.push).toHaveBeenCalledWith('/message/chat/5')
  })

  it('shows a retryable error and releases loading when the check request throws', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()
    fetchMock.kunFetchGet.mockRejectedValueOnce(new Error('network down'))

    const { container } = await renderButton()
    const startButton = container.querySelector<HTMLButtonElement>('button')
    expect(startButton).not.toBeNull()

    await act(async () => {
      startButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/conversation/check',
      { targetUserId: 8 }
    )
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('发起私聊失败，请稍后重试')
    expect(startButton?.disabled).toBe(false)
  })

  it('shows a retryable error and releases loading when opening an existing conversation throws', async () => {
    const toast = (await import('react-hot-toast')).default
    vi.mocked(toast.error).mockClear()
    fetchMock.kunFetchGet.mockResolvedValueOnce({
      exists: true,
      conversationId: 5,
      needsPayment: false,
      targetUserName: 'Mio'
    })
    fetchMock.kunFetchPost.mockRejectedValueOnce(new Error('network down'))

    const { container } = await renderButton()
    const startButton = container.querySelector<HTMLButtonElement>('button')
    expect(startButton).not.toBeNull()

    await act(async () => {
      startButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith(
      '/message/conversation',
      { targetUserId: 8 }
    )
    expect(routerMock.push).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('发起私聊失败，请稍后重试')
    expect(startButton?.disabled).toBe(false)
  })
})
