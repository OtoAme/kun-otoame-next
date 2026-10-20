import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LinkMaintenanceItem,
  LinkMaintenanceListResponse
} from '~/types/api/linkMaintenance'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: mocks.kunFetchPost
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
vi.mock('~/components/dashboard/ui/alert-dialog', async () => {
  const ReactModule = await import('react')
  const Ctx = ReactModule.createContext<(open: boolean) => void>(() => {})
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children
    }: {
      open?: boolean
      onOpenChange?: (open: boolean) => void
      children?: React.ReactNode
    }) => (
      <Ctx.Provider value={onOpenChange ?? (() => {})}>
        {open ? <div role="alertdialog">{children}</div> : null}
      </Ctx.Provider>
    ),
    AlertDialogContent: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
    AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => (
      <p>{children}</p>
    ),
    AlertDialogCancel: ({
      children,
      disabled
    }: {
      children?: React.ReactNode
      disabled?: boolean
    }) => {
      const onOpenChange = ReactModule.useContext(Ctx)
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOpenChange(false)}
        >
          {children}
        </button>
      )
    }
  }
})

vi.mock('~/components/dashboard/ui/select', async () => {
  const ReactModule = await import('react')
  type Option = { value: string; label?: React.ReactNode; disabled?: boolean }
  const Ctx = ReactModule.createContext<{
    value: string
    disabled?: boolean
    options: Option[]
    onValueChange?: (value: string) => void
  }>({ value: '', options: [] })
  const collect = (node: React.ReactNode, out: Option[]) => {
    ReactModule.Children.forEach(node, (child) => {
      if (!ReactModule.isValidElement(child)) return
      const props = child.props as {
        value?: string
        disabled?: boolean
        children?: React.ReactNode
      }
      if (typeof props.value === 'string') {
        out.push({
          value: props.value,
          label: props.children,
          disabled: props.disabled
        })
        return
      }
      collect(props.children, out)
    })
  }
  return {
    Select: ({
      value,
      disabled,
      onValueChange,
      children
    }: {
      value?: string
      disabled?: boolean
      onValueChange?: (value: string) => void
      children?: React.ReactNode
    }) => {
      const options: Option[] = []
      collect(children, options)
      return (
        <Ctx.Provider
          value={{ value: value ?? '', disabled, options, onValueChange }}
        >
          <div>{children}</div>
        </Ctx.Provider>
      )
    },
    SelectTrigger: ({
      'aria-label': ariaLabel,
      className
    }: {
      children?: React.ReactNode
      'aria-label'?: string
      className?: string
    }) => {
      const ctx = ReactModule.useContext(Ctx)
      return (
        <select
          aria-label={ariaLabel}
          className={className}
          disabled={ctx.disabled}
          value={ctx.value}
          onChange={(event) => ctx.onValueChange?.(event.target.value)}
        >
          {ctx.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectItem: ({
      children,
      value
    }: {
      children?: React.ReactNode
      value: string
    }) => <span data-value={value}>{children}</span>
  }
})

import {
  WorkspaceMaintenance,
  maintenanceBody
} from '~/components/dashboard/workspace/WorkspaceMaintenance'

const item = (
  overrides: Partial<LinkMaintenanceItem> = {}
): LinkMaintenanceItem => ({
  patchId: 3,
  resourceId: 9,
  linkId: 22,
  linkVersion: 4,
  eventId: 1,
  round: 1,
  maintenanceRevision: 6,
  state: 'pending',
  snoozedUntil: null,
  openedAt: '2026-10-01T00:00:00.000Z',
  respondedAt: null,
  response: null,
  reportCount: 2,
  caseId: 44,
  patch: { uniqueId: 'game', name: '游戏甲' },
  resource: { name: '资源甲', section: 'galgame' },
  storage: 'user',
  health: {
    version: 4,
    evidenceRound: 2,
    health: 'broken',
    healthChangedAt: '2026-10-01T00:00:00.000Z',
    verifiedAt: null,
    lastRelinkAt: null,
    ownerType: 'publisher',
    disputeSource: null,
    recentReportCount: 2,
    latestCheck: null,
    capabilities: {
      ownerActions: [],
      resolveActions: [],
      canCheck: false,
      canEdit: false
    }
  },
  capabilities: { actions: ['respond', 'verify', 'snooze', 'stop'] },
  ...overrides
})

const list = (items: LinkMaintenanceItem[]): LinkMaintenanceListResponse => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
  actionableCount: 3
})

describe('maintenance request bodies', () => {
  const pending = {
    item: item(),
    note: '  可用  ',
    days: 3 as const
  }

  it('keeps verify basis and does not add fields to snooze or resume', () => {
    expect(maintenanceBody({ ...pending, action: 'verify' })).toEqual({
      patchId: 3,
      resourceId: 9,
      linkId: 22,
      linkVersion: 4,
      maintenanceRevision: 6,
      action: 'verify',
      note: '可用',
      basis: {
        patchId: 3,
        resourceId: 9,
        linkId: 22,
        linkVersion: 4,
        evidenceRound: 2,
        health: 'broken',
        healthChangedAt: '2026-10-01T00:00:00.000Z'
      }
    })
    expect(maintenanceBody({ ...pending, action: 'snooze' })).toEqual({
      patchId: 3,
      resourceId: 9,
      linkId: 22,
      linkVersion: 4,
      maintenanceRevision: 6,
      action: 'snooze',
      days: 3
    })
    expect(
      Object.keys(maintenanceBody({ ...pending, action: 'resume' }))
    ).toEqual([
      'patchId',
      'resourceId',
      'linkId',
      'linkVersion',
      'maintenanceRevision',
      'action'
    ])
    const stopped = maintenanceBody({ ...pending, action: 'stop' })
    expect(stopped.action).toBe('stop')
    if (stopped.action === 'stop') expect(stopped.note).toBe('可用')
  })
})

describe('workspace maintenance', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.kunFetchGet.mockResolvedValue(list([item()]))
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/workspace/resources'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<WorkspaceMaintenance />)
    })
    await act(async () => {})
    return container
  }

  const button = (rootNode: ParentNode, text: string) =>
    [...rootNode.querySelectorAll('button')].find((item) =>
      item.textContent?.includes(text)
    )

  const setText = (textarea: HTMLTextAreaElement, value: string) => {
    const proto = Object.getOwnPropertyDescriptor(
      dom!.window.HTMLTextAreaElement.prototype,
      'value'
    )
    proto?.set?.call(textarea, value)
    textarea.dispatchEvent(new dom!.window.Event('input', { bubbles: true }))
  }

  it('writes nothing when a confirmed action is cancelled', async () => {
    const container = await mount()
    expect(container.textContent).toContain('待处理 3')
    expect(
      container.querySelector('a[href="/workspace/resources/9?linkId=22"]')
    ).not.toBeNull()
    expect(
      container.querySelector('a[href="/workspace/issues/44"]')?.textContent
    ).toContain('关联事项')
    const gets = mocks.kunFetchGet.mock.calls.length
    await act(async () => {
      button(container, '暂缓')!.click()
    })
    const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
    expect(container.querySelector('[aria-label="维护分区"]')).not.toBeNull()
    const days = dialog.querySelector(
      '[aria-label="暂缓天数"]'
    ) as HTMLSelectElement
    expect(days).not.toBeNull()
    expect([...days.options].map((option) => option.value)).toEqual(['1', '3'])
    const proto = Object.getOwnPropertyDescriptor(
      dom!.window.HTMLSelectElement.prototype,
      'value'
    )
    await act(async () => {
      proto?.set?.call(days, '3')
      days.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
    expect(dialog.textContent).toContain('到期后这条维护会回到待处理')
    expect(dialog.textContent).toContain('暂停期间不会发出处理结果')
    expect(dialog.textContent).not.toContain('不会自动重新报告')
    expect(dialog.textContent).not.toContain('取消不会发送请求')
    expect(container.textContent).not.toContain('唯一的维护清单')
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    await act(async () => {
      button(dialog, '取消')!.click()
    })
    expect(
      dom!.window.document.querySelector('[role="alertdialog"]')
    ).toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(gets)
  })

  it('submits the selected snooze length as 1 or 3 days', async () => {
    mocks.kunFetchPost.mockResolvedValue({ ok: true })
    const container = await mount()
    await act(async () => {
      button(container, '暂缓')!.click()
    })
    const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
    const days = dialog.querySelector(
      '[aria-label="暂缓天数"]'
    ) as HTMLSelectElement
    const proto = Object.getOwnPropertyDescriptor(
      dom!.window.HTMLSelectElement.prototype,
      'value'
    )
    await act(async () => {
      proto?.set?.call(days, '3')
      days.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
    await act(async () => {
      button(dialog, '确认')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/workspace/maintenance',
      expect.objectContaining({ action: 'snooze', days: 3 })
    )
    const body = mocks.kunFetchPost.mock.calls.at(-1)?.[1] as { note?: string }
    expect(body.note).toBeUndefined()
  })

  it('keeps the note when the action returns 409', async () => {
    const container = await mount()
    // The note input only exists inside the respond/verify/stop dialog
    expect(
      container.querySelector('textarea[aria-label="维护说明"]')
    ).toBeNull()
    await act(async () => {
      button(container, '回应')!.click()
    })
    mocks.kunFetchPost.mockResolvedValue('该链接的维护状态已变化，请刷新后重试')
    const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
    const note = dialog.querySelector(
      'textarea[aria-label="维护说明"]'
    ) as HTMLTextAreaElement
    await act(async () => {
      setText(note, '已经换了新地址')
    })
    await act(async () => {
      button(dialog, '确认')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/workspace/maintenance',
      expect.objectContaining({
        action: 'respond',
        note: '已经换了新地址',
        patchId: 3,
        resourceId: 9,
        linkId: 22,
        linkVersion: 4,
        maintenanceRevision: 6
      })
    )
    expect(note.value).toBe('已经换了新地址')
    const openDialog = dom!.window.document.querySelector(
      '[role="alertdialog"]'
    )!
    const alerts = [...dom!.window.document.querySelectorAll('[role="alert"]')]
    expect(alerts).toHaveLength(1)
    expect(openDialog.contains(alerts[0]!)).toBe(true)
    expect(alerts[0]?.textContent).toContain(
      '该链接的维护状态已变化，请刷新后重试'
    )
    const posts = mocks.kunFetchPost.mock.calls.length
    const gets = mocks.kunFetchGet.mock.calls.length
    await act(async () => {
      button(openDialog, '取消')!.click()
    })
    expect(
      dom!.window.document.querySelector('[role="alertdialog"]')
    ).toBeNull()
    // 取消保留输入：重新打开弹窗时说明仍在
    await act(async () => {
      button(container, '回应')!.click()
    })
    const reopened = dom!.window.document.querySelector('[role="alertdialog"]')!
    expect(
      (
        reopened.querySelector(
          'textarea[aria-label="维护说明"]'
        ) as HTMLTextAreaElement
      ).value
    ).toBe('已经换了新地址')
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(posts)
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(gets)
  })

  it('shows Chinese labels for maintenance state and storage', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      list([
        item({ state: 'pending', storage: 'user' }),
        item({
          linkId: 23,
          state: 'snoozed',
          storage: 's3',
          snoozedUntil: '2099-01-01T00:00:00.000Z',
          capabilities: { actions: [] }
        }),
        item({
          linkId: 24,
          state: 'optional',
          storage: 'touchgal',
          capabilities: { actions: [] }
        }),
        item({
          linkId: 25,
          state: 'handled',
          storage: 'user',
          capabilities: { actions: [] }
        }),
        item({
          linkId: 26,
          state: 'stopped',
          storage: 's3',
          capabilities: { actions: [] }
        })
      ])
    )
    const container = await mount()
    const badges = [...container.querySelectorAll('[data-slot="badge"]')].map(
      (badge) => badge.textContent
    )
    expect(badges).toEqual([
      '待处理',
      '已暂缓',
      '可选处理',
      '已处理',
      '已停止维护'
    ])
    expect(container.textContent).toContain('自定义链接下载')
    expect(container.textContent).toContain('对象存储下载')
    expect(container.textContent).toContain('OtoAme 资源盘')
    expect(container.textContent).toContain('暂缓至 2099-01-01T00:00:00.000Z')
    expect(container.textContent).not.toMatch(
      /\b(pending|snoozed|optional|handled|stopped|touchgal|s3|user)\b/
    )
  })

  it('re-reads an expired snooze without posting', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      list([
        item({
          state: 'snoozed',
          snoozedUntil: '2020-01-01T00:00:00.000Z',
          capabilities: { actions: ['resume'] }
        })
      ])
    )
    const container = await mount()
    expect(container.textContent).toContain(
      '暂缓已到期，回到待处理，请重新读取。'
    )
    const gets = mocks.kunFetchGet.mock.calls.length
    const reread = [...container.querySelectorAll('ul button')].find((item) =>
      item.textContent?.includes('重新读取')
    ) as HTMLButtonElement
    await act(async () => {
      reread.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(mocks.kunFetchGet.mock.calls.length).toBeGreaterThan(gets)
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith(
      '/workspace/maintenance',
      expect.objectContaining({ view: 'feedback' })
    )
  })

  it('re-reads an expired snooze by itself and never posts a report', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      list([
        item({
          state: 'snoozed',
          snoozedUntil: '2020-01-01T00:00:00.000Z',
          capabilities: { actions: ['resume'] }
        })
      ])
    )
    const container = await mount()
    await act(async () => {})
    const reads = mocks.kunFetchGet.mock.calls.filter(
      (call) => call[0] === '/workspace/maintenance'
    )
    expect(reads.length).toBe(2)
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('不会自动提交报告')
    expect(container.textContent).not.toContain('唯一的维护清单')
  })

  it('ignores a stale maintenance response, including its loading and error', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    mocks.kunFetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        })
    )
    const container = await mount()
    expect(container.textContent).toContain('正在加载维护清单')
    await act(async () => {
      button(container, '已处理')!.click()
    })
    expect(resolvers).toHaveLength(2)
    resolvers[1]!(
      list([
        item({
          resource: { name: '新结果', section: 'galgame' }
        })
      ])
    )
    await act(async () => {})
    expect(container.textContent).toContain('新结果')
    expect(container.textContent).not.toContain('正在加载维护清单')
    resolvers[0]!('旧筛选失败')
    await act(async () => {})
    expect(container.textContent).toContain('新结果')
    expect(container.textContent).not.toContain('旧筛选失败')
    expect(container.textContent).not.toContain('正在加载维护清单')
  })
})
