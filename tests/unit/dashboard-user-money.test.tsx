import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  delete: vi.fn(),
  uuid: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  balance: vi.fn(),
  identity: { uid: 4 }
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchPost: mocks.post,
  kunFetchDelete: mocks.delete
}))
vi.mock('~/utils/random', () => ({ generateUUID: mocks.uuid }))
vi.mock('react-hot-toast', () => ({
  default: { success: mocks.success, error: mocks.error }
}))
vi.mock('~/store/userStore', () => ({
  useUserStore: {
    getState: () => ({
      user: mocks.identity,
      setMoemoepointBalance: mocks.balance
    })
  }
}))
vi.mock('~/components/dashboard/ui/input', () => ({
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={onChange as React.FormEventHandler<HTMLInputElement>}
    />
  )
}))
vi.mock('~/components/dashboard/ui/textarea', () => ({
  Textarea: ({ onChange, ...props }: React.ComponentProps<'textarea'>) => (
    <textarea
      {...props}
      onInput={onChange as React.FormEventHandler<HTMLTextAreaElement>}
    />
  )
}))
vi.mock('~/components/dashboard/ui/dialog', () => {
  const Context = React.createContext({
    open: false,
    change: (_open: boolean) => {}
  })
  const Box = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Dialog: ({
      open,
      onOpenChange,
      children
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      children: React.ReactNode
    }) => (
      <Context.Provider value={{ open, change: onOpenChange }}>
        {children}
      </Context.Provider>
    ),
    DialogTrigger: ({
      children
    }: {
      children: React.ReactElement<{ onClick?: () => void }>
    }) => {
      const c = React.useContext(Context)
      return React.cloneElement(children, { onClick: () => c.change(true) })
    },
    DialogContent: ({ children }: { children: React.ReactNode }) => {
      const c = React.useContext(Context)
      return c.open ? (
        <div role="dialog">
          <button onClick={() => c.change(false)}>关闭弹窗</button>
          {children}
        </div>
      ) : null
    },
    DialogHeader: Box,
    DialogTitle: Box,
    DialogDescription: Box,
    DialogFooter: Box
  }
})
vi.mock('~/components/dashboard/ui/alert-dialog', () => {
  const Context = React.createContext({
    open: false,
    change: (_open: boolean) => {}
  })
  const Box = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      children: React.ReactNode
    }) => (
      <Context.Provider value={{ open, change: onOpenChange }}>
        {children}
      </Context.Provider>
    ),
    AlertDialogTrigger: ({
      children
    }: {
      children: React.ReactElement<{ onClick?: () => void }>
    }) => {
      const c = React.useContext(Context)
      return React.cloneElement(children, { onClick: () => c.change(true) })
    },
    AlertDialogContent: ({ children }: { children: React.ReactNode }) =>
      React.useContext(Context).open ? (
        <div role="alertdialog">{children}</div>
      ) : null,
    AlertDialogCancel: ({
      disabled,
      children
    }: React.ComponentProps<'button'>) => {
      const c = React.useContext(Context)
      return (
        <button disabled={disabled} onClick={() => c.change(false)}>
          {children}
        </button>
      )
    },
    AlertDialogHeader: Box,
    AlertDialogTitle: Box,
    AlertDialogDescription: Box,
    AlertDialogFooter: Box
  }
})

import { GrantMoemoepointDialog } from '~/components/dashboard/user/GrantMoemoepointDialog'
import { DeleteUserDialog } from '~/components/dashboard/user/DeleteUserDialog'

const response = {
  balance: { total: -2, available: -5, reserved: 3 },
  applied: true
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('dashboard account grant and deletion', () => {
  let dom: JSDOM
  let root: Root
  let container: HTMLDivElement
  const granted = vi.fn()
  const deleted = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.identity.uid = 4
    mocks.post.mockResolvedValue(response)
    mocks.delete.mockResolvedValue({})
    let nonce = 0
    mocks.uuid.mockImplementation(() => `request-${++nonce}`)
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard/user'
    })
    vi.stubGlobal('React', React)
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('self', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })
  const renderGrant = (id = 7) =>
    act(async () =>
      root.render(
        <GrantMoemoepointDialog
          user={{ id, name: `用户${id}` }}
          currentUserId={4}
          onGranted={granted}
        />
      )
    )
  const renderDelete = (id = 7) =>
    act(async () =>
      root.render(
        <DeleteUserDialog
          user={{ id, name: `用户${id}` }}
          currentUserId={4}
          onDeleted={deleted}
        />
      )
    )
  const button = (text: string) => {
    const found = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === text
    )
    expect(found, text).toBeDefined()
    return found!
  }
  const click = (text: string) => act(async () => button(text).click())
  const fill = async (selector: string, value: string) => {
    const input = container.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(selector)!
    expect(input).not.toBeNull()
    await act(async () => {
      input.value = value
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  const openGrant = async (id = 7) => {
    await renderGrant(id)
    await click('发放萌萌点')
  }

  it('uses one confirmation and sends a trimmed reason with the captured target', async () => {
    await openGrant()
    await fill('input', '15')
    await fill('textarea', '  人工补发  ')
    await click('确认发放')
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/admin/user', {
      uid: 7,
      amount: 15,
      reason: '人工补发',
      requestId: 'request-1'
    })
    expect(granted).toHaveBeenCalledWith(7)
    expect(mocks.balance).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each(['0', '-1', '1.5', '100001'])(
    'blocks invalid grant amount %s',
    async (amount) => {
      await openGrant()
      await fill('input', amount)
      await click('确认发放')
      expect(mocks.post).not.toHaveBeenCalled()
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        '整数'
      )
    }
  )

  it('freezes the complete request after an unknown result and keeps it frozen after a business-error retry', async () => {
    mocks.post
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce('暂时不可用')
      .mockResolvedValueOnce({ ...response, applied: false })
    await openGrant()
    await fill('input', '25')
    await fill('textarea', '同一笔补发')
    await click('确认发放')
    expect(container.querySelector<HTMLInputElement>('input')?.disabled).toBe(
      true
    )
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea')?.disabled
    ).toBe(true)
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/user/7/moemoepoint'
    )
    expect(container.querySelector('a')?.target).toBe('_blank')
    await click('重试原请求')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      '暂时不可用'
    )
    expect(container.querySelector<HTMLInputElement>('input')?.disabled).toBe(
      true
    )
    await click('重试原请求')
    expect(mocks.post.mock.calls).toHaveLength(3)
    expect(mocks.post.mock.calls[1]).toEqual(mocks.post.mock.calls[0])
    expect(mocks.post.mock.calls[2]).toEqual(mocks.post.mock.calls[0])
    expect(mocks.uuid).toHaveBeenCalledTimes(1)
    expect(granted).toHaveBeenCalledTimes(1)
    expect(mocks.success).toHaveBeenLastCalledWith(
      '该请求此前已生效, 未重复发放'
    )
  })

  it('releases the lock and preserves input for a business error, including an empty string', async () => {
    mocks.post.mockResolvedValueOnce('')
    await openGrant()
    await fill('input', '31')
    await click('确认发放')
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('31')
    expect(container.querySelector<HTMLInputElement>('input')?.disabled).toBe(
      false
    )
    expect(granted).not.toHaveBeenCalled()
    await click('确认发放')
    expect(granted).toHaveBeenCalledWith(7)
  })

  it('blocks repeated submit and closing while the grant request is pending', async () => {
    const pending = deferred<typeof response>()
    mocks.post.mockReturnValueOnce(pending.promise)
    await openGrant()
    await fill('input', '11')
    await act(async () => {
      const b = button('确认发放')
      b.click()
      b.click()
    })
    await click('关闭弹窗')
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => pending.resolve(response))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('uses a new request for each opening and clears a frozen draft when the target changes', async () => {
    mocks.post.mockRejectedValueOnce(new Error('lost response'))
    await openGrant()
    await fill('input', '12')
    await click('确认发放')
    await renderGrant(8)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await click('发放萌萌点')
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('')
    await fill('input', '13')
    await click('确认发放')
    expect(mocks.post.mock.calls[1][1].uid).toBe(8)
    expect(mocks.post.mock.calls[1][1].requestId).not.toBe(
      mocks.post.mock.calls[0][1].requestId
    )
  })

  it('does not copy an old target failure into the newly selected user dialog', async () => {
    const pending = deferred<typeof response>()
    mocks.post.mockReturnValueOnce(pending.promise)
    await openGrant()
    await fill('input', '8')
    await click('确认发放')
    await renderGrant(8)
    await act(async () => pending.reject(new Error('old request')))
    await click('发放萌萌点')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('input')?.disabled).toBe(
      false
    )
  })

  it('updates only the live operator balance and preserves negative values', async () => {
    await openGrant(4)
    await fill('input', '2')
    await click('确认发放')
    expect(mocks.balance).toHaveBeenCalledWith(response.balance)
    await click('发放萌萌点')
    await fill('input', '2')
    mocks.identity.uid = 9
    await click('确认发放')
    expect(mocks.balance).toHaveBeenCalledTimes(1)
  })

  it('prevents self deletion', async () => {
    await renderDelete(4)
    expect(button('删除用户').disabled).toBe(true)
    await click('删除用户')
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('confirms deletion once and sends the target ID as a query parameter', async () => {
    await renderDelete()
    await click('删除用户')
    expect(
      container.querySelector('[role="alertdialog"]')?.textContent
    ).toContain('用户7')
    expect(mocks.delete).not.toHaveBeenCalled()
    await click('永久删除用户')
    expect(mocks.delete).toHaveBeenCalledExactlyOnceWith('/admin/user', {
      uid: 7
    })
    expect(deleted).toHaveBeenCalledWith(7)
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('keeps deletion errors visible and permits retry', async () => {
    mocks.delete
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('lost response'))
    await renderDelete()
    await click('删除用户')
    await click('永久删除用户')
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    await click('永久删除用户')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '结果未知'
    )
    expect(button('永久删除用户').disabled).toBe(false)
    await click('永久删除用户')
    expect(deleted).toHaveBeenCalledTimes(1)
  })

  it('blocks duplicate deletion and reports the original target after props change', async () => {
    const pending = deferred<Record<string, never>>()
    mocks.delete.mockReturnValueOnce(pending.promise)
    await renderDelete()
    await click('删除用户')
    await act(async () => {
      const b = button('永久删除用户')
      b.click()
      b.click()
    })
    expect(button('取消').disabled).toBe(true)
    await renderDelete(8)
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    await act(async () => pending.resolve({}))
    expect(mocks.delete).toHaveBeenCalledTimes(1)
    expect(deleted).toHaveBeenCalledWith(7)
  })
})
