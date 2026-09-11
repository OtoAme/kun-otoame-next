import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '~/types/api/inbox'

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  // Test-only switch: when true the AlertDialogContent stub keeps rendering
  // with data-state="closed" after close, standing in for Radix Presence
  // retaining the DOM during the exit animation. Default false preserves the
  // old immediate-unmount behavior for all pre-existing tests.
  retainClosed: { value: false }
}))
vi.mock('~/utils/kunFetch', () => ({ kunFetchPut: mocks.put }))
vi.mock('react-hot-toast', () => ({
  default: { success: mocks.success, error: mocks.error }
}))
vi.mock('~/components/dashboard/inbox/PreviewFrame', () => ({
  PreviewFrame: ({ src, title }: { src: string; title: string }) => (
    <iframe src={src} title={title} />
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
vi.mock('~/components/dashboard/ui/alert-dialog', () => {
  type CloseAutoFocus = (event: { preventDefault: () => void }) => void
  const Context = React.createContext<{
    open: boolean
    close: () => void
    autoFocusRef: { current: CloseAutoFocus | undefined }
  }>({ open: false, close: () => {}, autoFocusRef: { current: undefined } })
  const Box = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    AlertDialog: ({
      children,
      open,
      onOpenChange
    }: {
      children: React.ReactNode
      open: boolean
      onOpenChange: (open: boolean) => void
    }) => {
      const autoFocusRef = React.useRef<CloseAutoFocus | undefined>(undefined)
      const prevOpen = React.useRef(open)
      React.useEffect(() => {
        // Mirror Radix: closing the content fires onCloseAutoFocus exactly once.
        if (prevOpen.current && !open) {
          autoFocusRef.current?.({ preventDefault: () => {} })
        }
        prevOpen.current = open
      }, [open])
      return (
        <Context.Provider
          value={{ open, close: () => onOpenChange(false), autoFocusRef }}
        >
          {children}
        </Context.Provider>
      )
    },
    AlertDialogContent: ({
      children,
      onCloseAutoFocus,
      ...props
    }: {
      children?: React.ReactNode
      onCloseAutoFocus?: CloseAutoFocus
      className?: string
    }) => {
      const { open, autoFocusRef } = React.useContext(Context)
      autoFocusRef.current = onCloseAutoFocus
      const wasOpen = React.useRef(false)
      if (open) wasOpen.current = true
      if (!open && !(mocks.retainClosed.value && wasOpen.current)) return null
      return (
        <div
          role="alertdialog"
          data-state={open ? 'open' : 'closed'}
          {...props}
        >
          {children}
        </div>
      )
    },
    AlertDialogHeader: Box,
    AlertDialogTitle: Box,
    AlertDialogDescription: Box,
    AlertDialogFooter: Box,
    AlertDialogCancel: ({
      disabled,
      children
    }: React.ComponentProps<'button'>) => {
      const { close } = React.useContext(Context)
      return (
        <button disabled={disabled} onClick={close}>
          {children}
        </button>
      )
    }
  }
})

import { ResourceInboxDetail } from '~/components/dashboard/inbox/ResourceInboxDetail'
import { LegacyInboxDetail } from '~/components/dashboard/inbox/LegacyInboxDetail'

const resource = (
  id = 1,
  role = 2
): Extract<InboxItem, { kind: 'resource-apply' }> => ({
  key: `resource-apply:${id}`,
  kind: 'resource-apply',
  id,
  title: '待审资源',
  subtitle: '游戏',
  actor: { id: 7, name: '发布者' },
  waitingFrom: '2026-09-01T00:00:00Z',
  waitingSeconds: 3600,
  targetHref: '/game0001',
  badges: [],
  readOnly: false,
  payload: {
    id,
    name: '待审资源',
    section: 'galgame',
    type: ['pc', 'row'],
    language: ['ja'],
    platform: ['windows'],
    uniqueId: 'game0001',
    patchName: '游戏',
    note: '资源备注',
    links: [
      {
        id: 11,
        storage: 'user',
        size: '1 GB',
        hash: 'hash-fixture',
        sortOrder: 0,
        download: 2,
        content: 'https://example.test/download',
        code: 'abcd',
        password: 'only-fixture'
      }
    ],
    likeCount: 0,
    download: 2,
    isLike: false,
    status: 2,
    userId: 7,
    patchId: 8,
    created: '2026-09-01T00:00:00Z',
    user: { id: 7, name: '发布者', avatar: '', role, patchCount: 5 }
  }
})

describe('resource and legacy inbox details', () => {
  let dom: JSDOM
  let root: Root
  let container: HTMLDivElement
  const processed = vi.fn()
  const changed = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.retainClosed.value = false
    mocks.put.mockResolvedValue({})
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard'
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
  const render = async (item = resource()) => {
    await act(async () =>
      root.render(
        <ResourceInboxDetail
          item={item}
          onProcessed={processed}
          onStateChanged={changed}
        />
      )
    )
  }
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === label
    )
    expect(button, label).toBeDefined()
    await act(async () => button!.click())
  }
  const typeReason = async (value: string) => {
    const textarea = container.querySelector('textarea')!
    await act(async () => {
      textarea.value = value
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }

  it('shows the existing role/resource labels, authorized links and actual preview route', async () => {
    await render()
    expect(container.textContent).toContain('创作者')
    expect(container.textContent).toContain('游戏资源')
    expect(container.textContent).toContain('Windows')
    expect(container.textContent).toContain('abcd')
    expect(container.textContent).toContain('only-fixture')
    expect(container.querySelector('a[href="/game0001"]')).not.toBeNull()
    expect(container.querySelector('a[href^="/patch/"]')).toBeNull()
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      '/preview/resource/1'
    )
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('approve only opens a confirmation first, then the confirm button sends exactly one request', async () => {
    let finish!: (result: object) => void
    mocks.put.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    await render()
    const approve = container.querySelector<HTMLButtonElement>(
      '[data-inbox-action="positive"]'
    )!
    await act(async () => approve.click())
    const dialog = container.querySelector('[role="alertdialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('待审资源')
    expect(dialog?.textContent).toContain('游戏')
    expect(mocks.put).not.toHaveBeenCalled()
    const confirm = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '确认通过'
    )!
    expect(confirm, '确认通过').toBeDefined()
    await act(async () => {
      confirm.click()
      confirm.click()
    })
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
      '/admin/resource-apply/approve',
      { resourceId: 1 }
    )
    await render(resource(2))
    await act(async () => finish({}))
    expect(processed).toHaveBeenCalledExactlyOnceWith('resource-apply:1')
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      '/preview/resource/2'
    )
  })

  it('cancelling a confirmation closes it with zero writes', async () => {
    await render()
    await click('拒绝并删除')
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await typeReason('内容不可用')
    await click('取消')
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.put).not.toHaveBeenCalled()
    expect(processed).not.toHaveBeenCalled()
  })

  it('closes a stale confirmation without writing when the item changes quickly', async () => {
    await render()
    await click('拒绝并删除')
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await render(resource(2))
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('restores focus to the initiating marker button after cancelling', async () => {
    await render()
    const decline = container.querySelector<HTMLButtonElement>(
      '[data-inbox-action="destructive"]'
    )!
    await act(async () => decline.click())
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await click('取消')
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.put).not.toHaveBeenCalled()
    expect(dom.window.document.activeElement).toBe(decline)
  })

  it('does not refocus the trigger after a successful processing or an item change', async () => {
    await render()
    const approve = container.querySelector<HTMLButtonElement>(
      '[data-inbox-action="positive"]'
    )!
    await act(async () => approve.click())
    await click('确认通过')
    expect(processed).toHaveBeenCalledExactlyOnceWith('resource-apply:1')
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(dom.window.document.activeElement).not.toBe(approve)

    await render(resource(2))
    const decline = container.querySelector<HTMLButtonElement>(
      '[data-inbox-action="destructive"]'
    )!
    await act(async () => decline.click())
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await render(resource(3))
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.put).toHaveBeenCalledTimes(1)
    expect(dom.window.document.activeElement).not.toBe(decline)
  })

  it('shows a retryable inline error and unlocks the confirm after an approve failure', async () => {
    mocks.put.mockResolvedValueOnce('暂时无法处理')
    await render()
    await click('通过')
    await click('确认通过')
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
      '/admin/resource-apply/approve',
      { resourceId: 1 }
    )
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      '暂时无法处理'
    )
    const confirm = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '确认通过'
    )!
    expect(confirm.disabled).toBe(false)
    expect(processed).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    await act(async () => confirm.click())
    expect(mocks.put).toHaveBeenCalledTimes(2)
    expect(processed).toHaveBeenCalledExactlyOnceWith('resource-apply:1')
  })

  it('locks an in-flight request: duplicate confirms submit once and cancel stays disabled', async () => {
    let finish!: (result: object) => void
    mocks.put.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    await render()
    await click('拒绝并删除')
    await typeReason('内容不可用')
    const confirm = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '确认删除'
    )!
    await act(async () => {
      confirm.click()
      confirm.click()
    })
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
      '/admin/resource-apply/decline',
      { resourceId: 1, reason: '内容不可用' }
    )
    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '取消'
    )!
    expect(cancel.disabled).toBe(true)
    await act(async () => cancel.click())
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(mocks.put).toHaveBeenCalledTimes(1)
    await act(async () => finish({}))
    expect(processed).toHaveBeenCalledExactlyOnceWith('resource-apply:1')
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('requires one confirmation and a reason before declining, and retains the reason on failure', async () => {
    mocks.put.mockResolvedValueOnce('暂时无法处理')
    await render()
    await click('拒绝并删除')
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(mocks.put).not.toHaveBeenCalled()
    await click('确认删除')
    expect(mocks.put).not.toHaveBeenCalled()
    await typeReason('  内容不可用  ')
    await click('确认删除')
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
      '/admin/resource-apply/decline',
      { resourceId: 1, reason: '内容不可用' }
    )
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(container.querySelector('textarea')?.value.trim()).toBe('内容不可用')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      '暂时无法处理'
    )
    expect(processed).not.toHaveBeenCalled()
    await click('确认删除')
    expect(processed).toHaveBeenCalledExactlyOnceWith('resource-apply:1')
  })

  it.each(['当前资源状态无需审核', '该资源不存在'])(
    'refreshes only the captured item after the service responds %s',
    async (message) => {
      mocks.put.mockResolvedValueOnce(message)
      await render()
      await click('通过')
      expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
      expect(mocks.put).not.toHaveBeenCalled()
      await click('确认通过')
      expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
        '/admin/resource-apply/approve',
        { resourceId: 1 }
      )
      expect(changed).toHaveBeenCalledExactlyOnceWith('resource-apply:1')
      expect(processed).not.toHaveBeenCalled()
    }
  )

  it('keeps approve content in the retained closed DOM and a closed confirm click writes nothing', async () => {
    mocks.retainClosed.value = true
    await render()
    await click('通过')
    expect(
      container
        .querySelector('[role="alertdialog"]')
        ?.getAttribute('data-state')
    ).toBe('open')
    await click('取消')
    const closed = container.querySelector('[role="alertdialog"]')
    expect(closed).not.toBeNull()
    expect(closed?.getAttribute('data-state')).toBe('closed')
    expect(closed?.textContent).toContain('确认通过该资源？')
    expect(closed?.textContent).toContain('将通过资源')
    expect(closed?.textContent).not.toContain('确认拒绝并删除')
    const confirm = [...closed!.querySelectorAll('button')].find(
      (b) => b.textContent === '确认通过'
    )!
    expect(confirm, '确认通过').toBeDefined()
    expect(confirm.getAttribute('data-variant')).toBe('default')
    await act(async () => confirm.click())
    expect(mocks.put).not.toHaveBeenCalled()
    expect(processed).not.toHaveBeenCalled()
  })

  it('keeps decline content and the reason block in the retained closed DOM', async () => {
    mocks.retainClosed.value = true
    await render()
    await click('拒绝并删除')
    await typeReason('内容不可用')
    await click('取消')
    const closed = container.querySelector('[role="alertdialog"]')
    expect(closed).not.toBeNull()
    expect(closed?.getAttribute('data-state')).toBe('closed')
    expect(closed?.textContent).toContain('确认拒绝并删除该资源？')
    expect(closed?.textContent).toContain('拒绝原因')
    expect(closed?.textContent).not.toContain('确认通过该资源？')
    expect(closed?.querySelector('textarea')?.value).toBe('内容不可用')
    const confirm = [...closed!.querySelectorAll('button')].find(
      (b) => b.textContent === '确认删除'
    )!
    expect(confirm, '确认删除').toBeDefined()
    expect(confirm.getAttribute('data-variant')).toBe('destructive')
    await act(async () => confirm.click())
    expect(mocks.put).not.toHaveBeenCalled()
    expect(processed).not.toHaveBeenCalled()
  })

  it('shows the newly opened action after a retained close and still writes once on confirm', async () => {
    mocks.retainClosed.value = true
    await render()
    await click('通过')
    await click('取消')
    expect(
      container
        .querySelector('[role="alertdialog"]')
        ?.getAttribute('data-state')
    ).toBe('closed')
    await click('拒绝并删除')
    const reopened = container.querySelector('[role="alertdialog"]')
    expect(reopened?.getAttribute('data-state')).toBe('open')
    expect(reopened?.textContent).toContain('确认拒绝并删除该资源？')
    expect(reopened?.textContent).not.toContain('确认通过该资源？')
    await typeReason('内容不可用')
    await click('确认删除')
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
      '/admin/resource-apply/decline',
      { resourceId: 1, reason: '内容不可用' }
    )
    expect(processed).toHaveBeenCalledExactlyOnceWith('resource-apply:1')
  })

  it('shows associated feedback content and its old link without exposing mutations', async () => {
    const item: Extract<InboxItem, { kind: 'feedback' }> = {
      key: 'feedback:5',
      kind: 'feedback',
      id: 5,
      title: '反馈',
      subtitle: '用户',
      actor: null,
      waitingFrom: '2026-09-01T00:00:00Z',
      waitingSeconds: 10,
      targetHref: '/admin/feedback',
      badges: [],
      readOnly: true,
      payload: {
        id: 5,
        type: 'feedback',
        content: '<script>反馈全文</script>\n第二行',
        status: 0,
        link: 'javascript:alert(1)',
        created: '2026-09-01T00:00:00Z',
        sender: null
      }
    }
    await act(async () => root.render(<LegacyInboxDetail item={item} />))
    expect(container.textContent).toContain('<script>反馈全文</script>')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a[href="/admin/feedback"]')).not.toBeNull()
    expect(container.textContent).toContain('超级管理员')
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(container.querySelector('[data-inbox-action]')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'shows a readonly rating report with deleted target=%s',
    async (deleted) => {
      const item: Extract<InboxItem, { kind: 'report' }> = {
        key: 'report:6',
        kind: 'report',
        id: 6,
        title: '评价举报',
        subtitle: '游戏',
        actor: null,
        waitingFrom: '2026-09-01T00:00:00Z',
        waitingSeconds: 10,
        targetHref: '/admin/rating-report',
        badges: [],
        readOnly: true,
        payload: {
          id: 6,
          targetType: 'rating',
          status: 0,
          reason: '举报原因',
          handlerReply: '',
          patch: { id: 8, uniqueId: 'game0001', name: '游戏' },
          comment: null,
          rating: deleted
            ? null
            : {
                id: 9,
                shortSummary: '评价全文',
                overall: 8,
                recommend: 'yes',
                playStatus: 'finished_all'
              },
          sender: { id: 7, name: '举报人', avatar: '' },
          reportedUser: { id: 8, name: '被举报人', avatar: '' },
          created: '2026-09-01T00:00:00Z',
          handledAt: null,
          pendingForTarget: 3
        }
      }
      await act(async () => root.render(<LegacyInboxDetail item={item} />))
      expect(
        container.querySelector('a[href="/admin/rating-report"]')
      ).not.toBeNull()
      expect(container.querySelector('a[href="/game0001"]')).not.toBeNull()
      expect(container.textContent).toContain('同目标其他待处理举报 3 条')
      if (deleted) expect(container.textContent).toContain('被举报内容已删除')
      else {
        expect(container.textContent).toContain('评价全文')
        expect(container.textContent).toContain('推荐')
        expect(container.textContent).toContain('全线通关')
      }
      expect(container.querySelector('[data-inbox-action]')).toBeNull()
      expect(mocks.put).not.toHaveBeenCalled()
    }
  )
})
