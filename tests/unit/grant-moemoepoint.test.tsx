import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { AdminUser } from '~/types/api/admin'

globalThis.React = React

const NETWORK_UNKNOWN_MESSAGE =
  '网络异常, 发放结果未知。请点击"重试原请求"确认, 或关闭弹窗后前往用户账单核对。'

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('~/utils/kunFetch', () => ({ kunFetchPost: fetchMock }))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: toastMock }))

const userState = vi.hoisted(() => ({
  user: { uid: 9, role: 4 },
  setMoemoepointBalance: vi.fn()
}))
vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: typeof userState) => unknown) =>
    selector(userState)
}))

vi.mock('lucide-react', () => ({ Coins: () => <span /> }))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
    'aria-label': ariaLabel
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
    'aria-label'?: string
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={isDisabled || isLoading}
      onClick={onPress}
    >
      {children}
    </button>
  ),
  Input: ({
    label,
    value,
    onChange,
    isDisabled
  }: {
    label?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    isDisabled?: boolean
  }) => (
    // React 的 onChange 走 value tracker, 合成 input 事件到不了它; onInput 可以。
    <input
      aria-label={label}
      value={value}
      disabled={isDisabled}
      onInput={onChange}
      onChange={onChange}
    />
  ),
  Textarea: ({
    label,
    value,
    onChange,
    isDisabled
  }: {
    label?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
    isDisabled?: boolean
  }) => (
    <textarea
      aria-label={label}
      value={value}
      disabled={isDisabled}
      onInput={onChange}
      onChange={onChange}
    />
  ),
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
        role="dialog"
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
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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

import { GrantMoemoepoint } from '~/components/admin/user/GrantMoemoepoint'

const user = {
  id: 5,
  name: 'Mio',
  email: 'mio@example.com',
  enable2FA: false,
  bio: '',
  avatar: '',
  role: 1,
  status: 0,
  dailyImageCount: 0,
  created: '2026-08-27T00:00:00.000Z',
  _count: { patch: 0, patch_resource: 0 }
} satisfies AdminUser

describe('GrantMoemoepoint idempotent retry', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/admin/user'
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

  const buttons = () => [...dom.window.document.querySelectorAll('button')]

  const buttonWithText = (text: string) =>
    buttons().find((button) => button.textContent === text)

  const click = async (button: HTMLButtonElement | undefined) => {
    expect(button).toBeDefined()
    await act(async () => {
      button?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const amountInput = () =>
    dom.window.document.querySelector<HTMLInputElement>(
      'input[aria-label="数量"]'
    )

  const reasonInput = () =>
    dom.window.document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="理由 (可选)"]'
    )

  const type = async (
    element: HTMLInputElement | HTMLTextAreaElement | null,
    value: string
  ) => {
    expect(element).not.toBeNull()
    const prototype =
      element instanceof dom.window.HTMLTextAreaElement
        ? dom.window.HTMLTextAreaElement.prototype
        : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
      element,
      value
    )
    await act(async () => {
      element?.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }

  const openAndFill = async (amount: string, reason?: string) => {
    await act(async () => {
      root.render(<GrantMoemoepoint user={user} />)
    })
    await click(
      buttons().find(
        (button) => button.getAttribute('aria-label') === '为 Mio 发放萌萌点'
      )
    )
    await type(amountInput(), amount)
    if (reason) {
      await type(reasonInput(), reason)
    }
  }

  it('locks onto the original request when the network result is unknown', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    await openAndFill('50')
    await click(buttonWithText('确认发放'))

    expect(toastMock.error).toHaveBeenCalledWith(NETWORK_UNKNOWN_MESSAGE)
    expect(dom.window.document.querySelector('[role="dialog"]')).not.toBeNull()

    const retry = buttonWithText('重试原请求')
    expect(retry).toBeDefined()
    expect(retry?.disabled).toBe(false)
    expect(amountInput()?.disabled).toBe(true)
    expect(reasonInput()?.disabled).toBe(true)
  })

  it('resends the very same request id and amount on retry', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        balance: { total: 150, reserved: 0, available: 150 },
        applied: false
      })

    await openAndFill('50')
    await click(buttonWithText('确认发放'))
    await click(buttonWithText('重试原请求'))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [firstUrl, firstBody] = fetchMock.mock.calls[0]
    const [secondUrl, secondBody] = fetchMock.mock.calls[1]
    expect(firstUrl).toBe('/admin/user')
    expect(secondUrl).toBe('/admin/user')
    expect(typeof firstBody.requestId).toBe('string')
    expect(secondBody).toEqual(firstBody)
  })

  it('keeps the form open so the admin can reconcile a business error', async () => {
    fetchMock.mockResolvedValueOnce('该请求标识已用于另一笔发放')

    await openAndFill('50', '活动奖励')
    await click(buttonWithText('确认发放'))

    expect(toastMock.error).toHaveBeenCalledWith('该请求标识已用于另一笔发放')
    expect(dom.window.document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(amountInput()?.value).toBe('50')
    expect(reasonInput()?.value).toBe('活动奖励')
  })

  it('reports a replay as already effective instead of a second grant', async () => {
    fetchMock.mockResolvedValueOnce({
      balance: { total: 150, reserved: 0, available: 150 },
      applied: false
    })

    await openAndFill('50')
    await click(buttonWithText('确认发放'))

    expect(toastMock.success).toHaveBeenCalledWith(
      '该请求此前已生效, 未重复发放'
    )
    expect(dom.window.document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('blocks every dismissal path while the grant is in flight', async () => {
    let release: ((value: unknown) => void) | undefined
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )

    await openAndFill('50')
    await click(buttonWithText('确认发放'))

    const dialog = dom.window.document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('data-dismissable')).toBe('false')
    expect(dialog?.getAttribute('data-keyboard-dismiss-disabled')).toBe('true')
    expect(dialog?.getAttribute('data-hide-close-button')).toBe('true')
    expect(buttonWithText('取消')?.disabled).toBe(true)

    await act(async () => {
      release?.({
        balance: { total: 150, reserved: 0, available: 150 },
        applied: true
      })
      await Promise.resolve()
      await Promise.resolve()
    })
  })
})
