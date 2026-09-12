import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn(),
  kunFetchPut: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  routerPush: vi.fn(),
  search: '',
  uuid: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: mocks.kunFetchPost,
  kunFetchPut: mocks.kunFetchPut
}))

vi.mock('~/utils/random', () => ({ generateUUID: mocks.uuid }))

vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError }
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/shoutbox',
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => new URLSearchParams(mocks.search)
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...rest
  }: React.ComponentProps<'a'> & { href: string; prefetch?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

vi.mock('~/components/dashboard/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel
  }: React.ComponentProps<'button'> & { 'aria-label'?: string }) => (
    <button aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}))

vi.mock('~/components/dashboard/ui/badge', () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('~/components/dashboard/ui/card', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Card: Box,
    CardHeader: Box,
    CardContent: Box,
    CardTitle: Box,
    CardDescription: Box
  }
})

vi.mock('~/components/dashboard/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />
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

vi.mock('~/components/dashboard/ui/select', () => {
  const Context = React.createContext<{
    value: string
    change: (value: string) => void
  }>({ value: '', change: () => {} })
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) => (
      <Context.Provider value={{ value, change: onValueChange }}>
        {children}
      </Context.Provider>
    ),
    SelectTrigger: ({ children, ...props }: React.ComponentProps<'button'>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const context = React.useContext(Context)
      return <span>{context.value || placeholder}</span>
    },
    SelectContent: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    SelectItem: ({
      value,
      children
    }: {
      value: string
      children: React.ReactNode
    }) => {
      const context = React.useContext(Context)
      return (
        <button type="button" onClick={() => context.change(value)}>
          {children}
        </button>
      )
    }
  }
})

vi.mock('~/components/dashboard/ui/tabs', () => {
  const Context = React.createContext<{
    value: string
    change: (value: string) => void
  }>({ value: '', change: () => {} })
  return {
    Tabs: ({
      value,
      onValueChange,
      children
    }: {
      value: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) => (
      <Context.Provider value={{ value, change: onValueChange }}>
        {children}
      </Context.Provider>
    ),
    TabsList: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    TabsTrigger: ({
      value,
      children
    }: {
      value: string
      children: React.ReactNode
    }) => {
      const context = React.useContext(Context)
      return (
        <button type="button" onClick={() => context.change(value)}>
          {children}
        </button>
      )
    },
    TabsContent: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    )
  }
})

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
    DialogContent: ({
      children,
      onCloseAutoFocus
    }: {
      children: React.ReactNode
      onCloseAutoFocus?: (event: Event) => void
    }) => {
      const context = React.useContext(Context)
      // Mirror Radix: the close-autofocus hook runs exactly once when an open
      // dialog closes (or unmounts while open). The latest callback is held in
      // a ref so a callback-identity change or a normal re-render while still
      // open never fires it early.
      const closeAutoFocusRef = React.useRef(onCloseAutoFocus)
      React.useEffect(() => {
        closeAutoFocusRef.current = onCloseAutoFocus
      }, [onCloseAutoFocus])
      React.useEffect(() => {
        if (!context.open) {
          return
        }
        return () => closeAutoFocusRef.current?.(new Event('close'))
      }, [context.open])
      if (!context.open) {
        return null
      }
      // A plain Dialog really has all three close paths: X, Escape, overlay.
      return (
        <div
          role="dialog"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              context.change(false)
            }
          }}
        >
          <div
            data-testid="dialog-overlay"
            onClick={() => context.change(false)}
          />
          <button aria-label="关闭" onClick={() => context.change(false)} />
          {children}
        </div>
      )
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
    AlertDialogContent: ({
      children,
      onCloseAutoFocus
    }: {
      children: React.ReactNode
      onCloseAutoFocus?: (event: Event) => void
    }) => {
      const context = React.useContext(Context)
      // Mirror Radix AlertDialog: the close-autofocus hook runs exactly once
      // when an open dialog closes (or unmounts while open); the latest
      // callback lives in a ref so identity changes or plain re-renders while
      // open never fire it early.
      const closeAutoFocusRef = React.useRef(onCloseAutoFocus)
      React.useEffect(() => {
        closeAutoFocusRef.current = onCloseAutoFocus
      }, [onCloseAutoFocus])
      React.useEffect(() => {
        if (!context.open) {
          return
        }
        return () => closeAutoFocusRef.current?.(new Event('close'))
      }, [context.open])
      if (!context.open) {
        return null
      }
      // A real AlertDialog has NO X/close button; Escape closes it, and
      // pointer-outside is prevented — the overlay node stays clickable in
      // the test but deliberately does not change open state.
      return (
        <div
          role="alertdialog"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              context.change(false)
            }
          }}
        >
          <div data-testid="alert-overlay" onClick={() => {}} />
          {children}
        </div>
      )
    },
    AlertDialogCancel: ({
      disabled,
      children
    }: React.ComponentProps<'button'>) => {
      const context = React.useContext(Context)
      return (
        <button disabled={disabled} onClick={() => context.change(false)}>
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

import { DashboardShoutbox } from '~/components/dashboard/shoutbox/DashboardShoutbox'
import type {
  AdminShoutboxReviewItem,
  ShoutboxItem
} from '~/types/api/shoutbox'

const makeOfficial = (
  id: number,
  overrides: Partial<ShoutboxItem> = {}
): ShoutboxItem => ({
  id,
  user: { id: 9, name: '站长', avatar: '' },
  content: `官方消息 ${id}`,
  link: '',
  official: true,
  level: 'normal',
  status: 0,
  cost: 0,
  patch: null,
  effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
  effectiveTo: new Date(Date.now() + 3_600_000).toISOString(),
  editedAt: null,
  hiddenAt: null,
  refundedAt: null,
  reportable: true,
  created: new Date(Date.now() - 60_000).toISOString(),
  updated: new Date(Date.now() - 60_000).toISOString(),
  ...overrides
})

const makeUser = (
  id: number,
  overrides: Partial<AdminShoutboxReviewItem> = {}
): AdminShoutboxReviewItem => ({
  id,
  user: { id: 100 + id, name: `用户${id}`, avatar: '' },
  content: `小喇叭 ${id} 正文`,
  link: '',
  official: false,
  level: 'normal' as const,
  status: 0,
  cost: 50,
  patch: null,
  effectiveFrom: null,
  effectiveTo: null,
  editedAt: null,
  hiddenAt: null,
  refundedAt: null,
  reportable: true,
  created: new Date(Date.now() - id * 1000).toISOString(),
  updated: new Date(Date.now() - id * 1000).toISOString(),
  pendingReports: [],
  ...overrides
})

const listResponse = (
  items: Array<ShoutboxItem | AdminShoutboxReviewItem>
) => ({
  shoutboxes: items,
  page: 1,
  totalPages: 1
})

const fillInput = async (
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
) => {
  await act(async () => {
    const prototype =
      element instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
    setter.call(element, value)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

const clickButton = async (container: HTMLElement, label: string) => {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button')
  ).find((candidate) => candidate.textContent?.includes(label))
  expect(button, `button ${label}`).not.toBeNull()
  await act(async () => {
    button!.click()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('DashboardShoutbox', () => {
  let dom: JSDOM | undefined
  let root: Root | undefined
  let container: HTMLElement

  const renderPage = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard/shoutbox'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<DashboardShoutbox />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search = ''
    let nonce = 0
    mocks.uuid.mockImplementation(() => `request-${++nonce}`)
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

  it('loads only the official list and refills the edit dialog from the current item on every open', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([
        makeOfficial(40, {
          content: '本周六凌晨例行维护',
          level: 'important',
          link: '/doc/notice/maintenance'
        })
      ])
    )
    await renderPage()

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/shoutbox', {
      tab: 'official',
      page: 1,
      limit: 20
    })
    expect(container.textContent).toContain('本周六凌晨例行维护')
    expect(container.textContent).toContain('重要')

    // First open: prefilled from the item.
    const editButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent?.includes('编辑'))!
    expect(editButton).not.toBeNull()
    await act(async () => {
      editButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const dialog = () => container.querySelector('[role="dialog"]')
    const textarea = () =>
      dialog()?.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="官方消息正文"]'
      )
    expect(textarea()?.value).toBe('本周六凌晨例行维护')

    // Dirty the draft, cancel, reopen: the abandoned draft must be gone, and
    // closing hands focus back to the edit button.
    await fillInput(textarea()!, '改动后的内容')
    await clickButton(container, '取消')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(editButton)

    await act(async () => {
      editButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(textarea()?.value).toBe('本周六凌晨例行维护')

    // Saving from a fresh open writes through the official update endpoint,
    // and a successful save also returns focus to the edit button.
    mocks.kunFetchPut.mockResolvedValue({})
    await fillInput(textarea()!, '维护改到周日凌晨')
    await clickButton(container, '保存')
    expect(mocks.kunFetchPut).toHaveBeenCalledWith(
      '/admin/shoutbox',
      expect.objectContaining({
        shoutboxId: 40,
        content: '维护改到周日凌晨',
        level: 'important',
        link: '/doc/notice/maintenance',
        effectiveFrom: expect.any(String),
        effectiveTo: expect.any(String)
      })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('官方消息已更新')
    expect(document.activeElement).toBe(editButton)
  })

  it('confirms 提前结束 before writing, and only then refreshes the list', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeOfficial(41)]))
    await renderPage()
    mocks.kunFetchGet.mockClear()

    // An active official message offers both 提前结束 and 撤回.
    await clickButton(container, '提前结束')
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()

    mocks.kunFetchPut.mockResolvedValue({})
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeOfficial(41)]))
    await clickButton(container, '确认结束')

    expect(mocks.kunFetchPut).toHaveBeenCalledWith('/admin/shoutbox', {
      shoutboxId: 41,
      action: 'end'
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('操作已完成')
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/shoutbox', {
      tab: 'official',
      page: 1,
      limit: 20
    })

    // The still-active message (list refreshed with the same row) can also be
    // withdrawn, again only after the second confirmation.
    await clickButton(container, '撤回')
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(mocks.kunFetchPut).toHaveBeenCalledTimes(1)

    await clickButton(container, '确认撤回')
    expect(mocks.kunFetchPut).toHaveBeenCalledWith('/admin/shoutbox', {
      shoutboxId: 41,
      action: 'cancel'
    })
  })

  it('confirms 撤回 for a not-yet-effective official message before writing', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([
        makeOfficial(42, {
          effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
          effectiveTo: new Date(Date.now() + 7_200_000).toISOString()
        })
      ])
    )
    await renderPage()

    // A future message cannot be ended, only withdrawn.
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('提前结束')
      )
    ).toBe(false)

    await clickButton(container, '撤回')
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()

    mocks.kunFetchPut.mockResolvedValue({})
    await clickButton(container, '确认撤回')
    expect(mocks.kunFetchPut).toHaveBeenCalledWith('/admin/shoutbox', {
      shoutboxId: 42,
      action: 'cancel'
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('操作已完成')
  })

  const findRow = (text: string) => {
    const row = Array.from(
      container.querySelectorAll<HTMLElement>('div.rounded-md.border')
    ).find((candidate) => candidate.textContent?.includes(text))
    expect(row, `row containing ${text}`).not.toBeNull()
    return row!
  }

  const rowButtons = (row: HTMLElement, label: string) =>
    Array.from(row.querySelectorAll<HTMLButtonElement>('button')).filter(
      (button) => button.textContent?.includes(label)
    )

  it('switches tabs through the URL, resets the page and refetches with the new tab', async () => {
    mocks.search = 'tab=public&page=2'
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeUser(50)]))
    await renderPage()
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/shoutbox', {
      tab: 'public',
      page: 2,
      limit: 20
    })

    await clickButton(container, '待复核')
    expect(mocks.routerPush).toHaveBeenCalledWith(
      '/dashboard/shoutbox?tab=pending_review',
      { scroll: false }
    )

    mocks.search = 'tab=pending_review'
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeUser(51)]))
    await act(async () => {
      root!.render(<DashboardShoutbox />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/shoutbox', {
      tab: 'pending_review',
      page: 1,
      limit: 20
    })
    expect(container.textContent).toContain('小喇叭 51 正文')
  })

  it('shows pending report evidence and requires confirmation before hiding', async () => {
    mocks.search = 'tab=pending_review'
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([
        makeUser(60, {
          pendingReports: [
            {
              id: 9001,
              reason: '涉嫌广告刷屏',
              sender: { id: 300, name: '举报人甲', avatar: '' },
              created: '2026-09-12T08:00:00.000Z'
            }
          ]
        })
      ])
    )
    await renderPage()

    const row = findRow('小喇叭 60 正文')
    expect(row.textContent).toContain('举报人甲')
    expect(row.textContent).toContain('涉嫌广告刷屏')
    expect(row.textContent).toContain('待处理举报 1 条')

    // A public user message with reports offers hide/remove/resolve; nothing
    // is written before the confirmation.
    mocks.kunFetchPost.mockResolvedValue({})
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    const hideButton = rowButtons(row, '暂时隐藏')[0]!
    await act(async () => {
      hideButton.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()

    await clickButton(container, '确认隐藏')
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/admin/shoutbox/moderate',
      {
        shoutboxId: 60,
        action: 'hide'
      }
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('操作已完成')
  })

  it('shows only status-appropriate actions for hidden, self-deleted and official rows', async () => {
    mocks.search = 'tab=pending_review'
    const reportEvidence = {
      id: 9002,
      reason: '内容违规',
      sender: { id: 300, name: '举报人甲', avatar: '' },
      created: '2026-09-12T08:00:00.000Z'
    }
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([
        makeUser(70, { status: 2, pendingReports: [] }),
        makeUser(71, { status: 1, pendingReports: [reportEvidence] }),
        {
          ...makeOfficial(72, { content: '官方公告正文' }),
          pendingReports: [reportEvidence]
        }
      ])
    )
    await renderPage()

    const hidden = findRow('小喇叭 70 正文')
    expect(hidden.textContent).toContain('站方主动隐藏')
    expect(rowButtons(hidden, '删除')).toHaveLength(1)
    expect(rowButtons(hidden, '恢复公开')).toHaveLength(1)
    expect(rowButtons(hidden, '暂时隐藏')).toHaveLength(0)
    expect(rowButtons(hidden, '举报结案')).toHaveLength(0)

    const selfDeleted = findRow('小喇叭 71 正文')
    expect(rowButtons(selfDeleted, '举报结案')).toHaveLength(1)
    expect(rowButtons(selfDeleted, '删除')).toHaveLength(0)
    expect(rowButtons(selfDeleted, '恢复公开')).toHaveLength(0)
    expect(rowButtons(selfDeleted, '暂时隐藏')).toHaveLength(0)

    const official = findRow('官方公告正文')
    expect(rowButtons(official, '举报结案')).toHaveLength(1)
    expect(rowButtons(official, '删除')).toHaveLength(0)
    expect(rowButtons(official, '暂时隐藏')).toHaveLength(0)
    expect(rowButtons(official, '恢复公开')).toHaveLength(0)
  })

  it('resolve requires a conclusion, writes the exact payload after confirm, and cancel restores focus', async () => {
    mocks.search = 'tab=pending_review'
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([
        makeUser(80, {
          pendingReports: [
            {
              id: 9003,
              reason: '引战',
              sender: { id: 301, name: '举报人乙', avatar: '' },
              created: '2026-09-12T09:00:00.000Z'
            }
          ]
        })
      ])
    )
    await renderPage()

    const row = findRow('小喇叭 80 正文')
    const resolveButton = rowButtons(row, '举报结案')[0]!
    await act(async () => {
      resolveButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    // No conclusion yet: local validation blocks the write.
    await clickButton(container, '提交结案')
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(container.textContent).toContain('请选择结案结论')

    // Cancelling never writes and focus returns to the trigger button.
    await clickButton(container, '取消')
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(resolveButton)

    await act(async () => {
      resolveButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await clickButton(container, '受理（举报成立）')
    mocks.kunFetchPost.mockResolvedValue({})
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    await clickButton(container, '提交结案')
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/admin/shoutbox/moderate',
      {
        shoutboxId: 80,
        action: 'resolve',
        resolution: 'accept',
        content: ''
      }
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('举报已结案')
  })

  it('restores a removed user message only after confirmation', async () => {
    mocks.search = 'tab=removed'
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeUser(90, { status: 3 })])
    )
    await renderPage()

    const row = findRow('小喇叭 90 正文')
    expect(row.textContent).toContain('违规删除')
    const restoreButton = rowButtons(row, '恢复公开')[0]!
    expect(restoreButton).not.toBeNull()
    expect(rowButtons(row, '暂时隐藏')).toHaveLength(0)
    expect(rowButtons(row, '删除')).toHaveLength(0)

    await act(async () => {
      restoreButton.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()

    mocks.kunFetchPost.mockResolvedValue({})
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    await clickButton(container, '确认恢复')
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/admin/shoutbox/moderate',
      {
        shoutboxId: 90,
        action: 'restore'
      }
    )
  })

  it('remove writes nothing on Cancel/Escape, stays open on overlay click, and writes the exact payload only after confirm', async () => {
    mocks.search = 'tab=pending_review'
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([
        makeUser(95, {
          pendingReports: [
            {
              id: 9004,
              reason: '垃圾信息',
              sender: { id: 302, name: '举报人丙', avatar: '' },
              created: '2026-09-12T10:00:00.000Z'
            }
          ]
        })
      ])
    )
    await renderPage()

    const row = findRow('小喇叭 95 正文')
    const removeButton = rowButtons(row, '删除')[0]!
    const alertDialog = () => container.querySelector('[role="alertdialog"]')

    const openConfirm = async () => {
      await act(async () => {
        removeButton.click()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(alertDialog()).not.toBeNull()
    }
    const expectClosedWithoutWrite = () => {
      expect(alertDialog()).toBeNull()
      expect(mocks.kunFetchPost).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(removeButton)
    }

    // Cancel: closes with zero writes, focus back on the trigger.
    await openConfirm()
    await clickButton(container, '取消')
    expectClosedWithoutWrite()

    // Escape: same contract.
    await openConfirm()
    await act(async () => {
      alertDialog()!.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expectClosedWithoutWrite()

    // A real AlertDialog has no X button, and pointer-outside is prevented:
    // the overlay click must leave the dialog open with zero writes; Cancel
    // then closes it and restores focus.
    await openConfirm()
    expect(alertDialog()!.querySelector('button[aria-label="关闭"]')).toBeNull()
    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-testid="alert-overlay"]')!
        .click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(alertDialog()).not.toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    await clickButton(container, '取消')
    expectClosedWithoutWrite()

    // Only the explicit confirm button writes, with the exact payload.
    await openConfirm()
    mocks.kunFetchPost.mockResolvedValue({})
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    await clickButton(container, '确认删除')
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/admin/shoutbox/moderate',
      {
        shoutboxId: 95,
        action: 'remove'
      }
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('操作已完成')
  })

  it('resolve dialog never writes on X, Escape or overlay close and restores focus', async () => {
    mocks.search = 'tab=pending_review'
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([
        makeUser(96, {
          pendingReports: [
            {
              id: 9005,
              reason: '引战',
              sender: { id: 303, name: '举报人丁', avatar: '' },
              created: '2026-09-12T10:30:00.000Z'
            }
          ]
        })
      ])
    )
    await renderPage()

    const row = findRow('小喇叭 96 正文')
    const resolveButton = rowButtons(row, '举报结案')[0]!
    const dialog = () => container.querySelector('[role="dialog"]')

    const openResolve = async () => {
      await act(async () => {
        resolveButton.click()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(dialog()).not.toBeNull()
    }
    const expectClosedWithoutWrite = () => {
      expect(dialog()).toBeNull()
      expect(mocks.kunFetchPost).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(resolveButton)
    }

    // X
    await openResolve()
    await act(async () => {
      dialog()!
        .querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!
        .click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expectClosedWithoutWrite()

    // Escape
    await openResolve()
    await act(async () => {
      dialog()!.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expectClosedWithoutWrite()

    // Overlay click
    await openResolve()
    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-testid="dialog-overlay"]')!
        .click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expectClosedWithoutWrite()
  })

  it('locates a single message via ?shoutbox= ignoring tab/page, and returns to the tab list', async () => {
    mocks.search = 'tab=public&page=3&shoutbox=60'
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeUser(60, { status: 2 })])
    )
    await renderPage()

    // The id drives the request; the tab filter and page are ignored.
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/shoutbox', {
      shoutboxId: 60,
      page: 1,
      limit: 20
    })
    expect(container.textContent).toContain('正在查看小喇叭 #60')
    // The targeted record keeps its status-appropriate moderation actions.
    const row = findRow('小喇叭 60 正文')
    expect(rowButtons(row, '恢复公开')).toHaveLength(1)
    // The tab strip and the official publish form stay out of this view.
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === '待复核'
      )
    ).toBe(false)
    expect(
      container.querySelector('textarea[aria-label="官方消息正文"]')
    ).toBeNull()

    await clickButton(container, '返回列表')
    expect(mocks.routerPush).toHaveBeenCalledWith(
      '/dashboard/shoutbox?tab=public',
      { scroll: false }
    )
  })

  it('shows a clear empty state when the targeted message does not exist', async () => {
    mocks.search = 'shoutbox=999'
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    await renderPage()

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/shoutbox', {
      shoutboxId: 999,
      page: 1,
      limit: 20
    })
    expect(container.textContent).toContain('未找到小喇叭 #999')
  })

  it('normalizes manual newlines in the official publish content', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    await renderPage()

    await fillInput(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="官方消息正文"]'
      )!,
      '第一行\n第二行'
    )
    mocks.kunFetchPost.mockResolvedValue(makeOfficial(43))
    await clickButton(container, '发布官方消息')
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/admin/shoutbox',
      expect.objectContaining({ content: '第一行 第二行' })
    )
  })

  it('normalizes stored and freshly typed newlines in the official edit dialog', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeOfficial(44, { content: '旧第一行\n旧第二行' })])
    )
    await renderPage()

    await clickButton(container, '编辑')
    const textarea = () =>
      container.querySelector<HTMLTextAreaElement>(
        '[role="dialog"] textarea[aria-label="官方消息正文"]'
      )
    // A stored newline is already a space when the dialog opens.
    expect(textarea()?.value).toBe('旧第一行 旧第二行')

    await fillInput(textarea()!, '改后\n内容')
    expect(textarea()?.value).toBe('改后 内容')
    mocks.kunFetchPut.mockResolvedValue({})
    await clickButton(container, '保存')
    expect(mocks.kunFetchPut).toHaveBeenCalledWith(
      '/admin/shoutbox',
      expect.objectContaining({ shoutboxId: 44, content: '改后 内容' })
    )
  })
})
