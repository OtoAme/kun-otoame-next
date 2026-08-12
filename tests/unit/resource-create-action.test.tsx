import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const userState = vi.hoisted(() => ({
  user: { uid: 0 }
}))

vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: typeof userState) => unknown) =>
    selector(userState)
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

vi.mock('lucide-react', () => ({
  Plus: () => <span data-testid="plus-icon" />
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    as: Component,
    children,
    href,
    onPress,
    startContent: _startContent,
    ...props
  }: {
    as?: React.ElementType
    children?: React.ReactNode
    href?: string
    onPress?: () => void
    [key: string]: unknown
  }) =>
    Component ? (
      <Component href={href}>{children}</Component>
    ) : (
      <button type="button" onClick={onPress} {...props}>
        {children}
      </button>
    ),
  Modal: ({
    children,
    isOpen
  }: {
    children?: React.ReactNode
    isOpen: boolean
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <section>{children}</section>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <header>{children}</header>
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

describe('ResourceCreateAction', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderAction = async (onOpenCreate = vi.fn()) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { ResourceCreateAction } = await import(
      '~/components/patch/resource/ResourceCreateAction'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<ResourceCreateAction onOpenCreate={onOpenCreate} />)
    })

    return { container: container!, onOpenCreate }
  }

  beforeEach(() => {
    userState.user = { uid: 0 }
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

  it('does not mount the create flow for guests before login', async () => {
    const { container, onOpenCreate } = await renderAction()

    expect(container.textContent).toContain('登录后添加资源')
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(onOpenCreate).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.textContent).toContain(
      '普通用户满足萌萌点要求后可以发布资源'
    )
    expect(container.querySelector('a[href="/login"]')).not.toBeNull()
    expect(container.querySelector('a[href="/register"]')).not.toBeNull()
  })

  it('opens the create flow directly for a logged-in ordinary user', async () => {
    userState.user = { uid: 12 }
    const { container, onOpenCreate } = await renderAction()

    expect(container.textContent).toContain('添加资源')
    expect(container.textContent).not.toContain('登录后添加资源')

    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(onOpenCreate).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
