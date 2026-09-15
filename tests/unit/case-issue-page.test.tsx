import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseListItem, CaseListResponse } from '~/types/api/case'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.kunFetchGet }))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className
  }: {
    children?: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  )
}))

vi.mock('@heroui/react', async () => {
  const R = await import('react')
  const toArray = (children: React.ReactNode): React.ReactElement[] =>
    (Array.isArray(children) ? children : [children]).filter(
      (child): child is React.ReactElement => R.isValidElement(child)
    )
  return {
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
        aria-label={ariaLabel}
        disabled={isDisabled || isLoading}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    Chip: ({ children }: { children?: React.ReactNode }) => (
      <span>{children}</span>
    ),
    Tabs: ({
      children,
      selectedKey,
      onSelectionChange,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      selectedKey?: string
      onSelectionChange?: (key: string) => void
      'aria-label'?: string
    }) => (
      <div role="tablist" aria-label={ariaLabel}>
        {toArray(children).map((tab) => {
          const key = String(tab.key ?? '').replace(/^\.\$/, '')
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === selectedKey}
              onClick={() => onSelectionChange?.(key)}
            >
              {(tab.props as { title?: React.ReactNode }).title}
            </button>
          )
        })}
      </div>
    ),
    Tab: () => null,
    Select: ({
      children,
      selectedKeys,
      onSelectionChange,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      selectedKeys?: string[]
      onSelectionChange?: (keys: Set<string>) => void
      'aria-label'?: string
    }) => (
      <select
        aria-label={ariaLabel}
        value={selectedKeys?.[0] ?? ''}
        onChange={(event) => onSelectionChange?.(new Set([event.target.value]))}
      >
        {toArray(children).map((child) => (
          <option key={String(child.key)} value={String(child.key)}>
            {(child.props as { children?: React.ReactNode }).children}
          </option>
        ))}
      </select>
    ),
    SelectItem: () => null
  }
})

vi.mock('~/components/kun/Loading', () => ({
  KunLoading: ({ hint }: { hint: string }) => <div role="status">{hint}</div>
}))
vi.mock('~/components/kun/Null', () => ({
  KunNull: ({ message }: { message: string }) => <div>{message}</div>
}))
vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: ({
    total,
    page,
    onPageChange
  }: {
    total: number
    page: number
    onPageChange: (page: number) => void
  }) => (
    <div data-testid="pagination" data-total={total} data-page={page}>
      <button type="button" onClick={() => onPageChange(page + 1)}>
        下一页
      </button>
    </div>
  )
}))

import { CaseTabsContainer } from '~/components/case/CaseTabsContainer'

globalThis.React = React

const listItem = (overrides: Partial<CaseListItem> = {}): CaseListItem => ({
  id: 1,
  kind: 'resource_mismatch',
  targetType: 'resource',
  targetId: 7,
  target: {
    targetType: 'resource',
    targetId: 7,
    deleted: false,
    patch: { id: 3, uniqueId: 'abc', name: '条目A' },
    resource: {
      id: 7,
      name: '资源X',
      section: 'galgame',
      patchId: 3,
      patch: { id: 3, uniqueId: 'abc', name: '条目A' },
      status: 0
    }
  },
  patchId: 3,
  ownerType: 'publisher',
  owner: null,
  reporter: null,
  status: 'open',
  resolution: null,
  public: true,
  source: 'user',
  subscriberCount: 2,
  reopenedCount: 0,
  escalatedAt: null,
  firstOwnerResponseAt: null,
  closedAt: null,
  statusChangedAt: '2026-09-13T00:00:00.000Z',
  queueEnteredAt: '2026-09-13T00:00:00.000Z',
  hiddenAt: null,
  restoredAt: null,
  created: '2026-09-13T00:00:00.000Z',
  updated: '2026-09-13T00:00:00.000Z',
  latestMessage: {
    id: 11,
    kind: 'reply',
    event: null,
    body: '正文预览内容',
    created: '2026-09-13T00:00:00.000Z'
  },
  canReply: true,
  canResolve: false,
  canReopen: false,
  ...overrides
})

const listResponse = (
  items: CaseListItem[],
  total = items.length
): CaseListResponse => ({
  tab: 'reported',
  cases: items,
  total,
  page: 1,
  limit: 20
})

describe('case issue page', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async (ui: React.ReactElement) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // react-dom 必须在 window/document stub 之后加载，否则合成事件不生效
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    return container
  }

  const flush = async () => {
    await act(async () => {})
  }

  it('fetches reported tab without status by default and renders rows', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([listItem()]))
    const container = await mount(<CaseTabsContainer />)
    await flush()

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/case', {
      tab: 'reported',
      page: 1,
      limit: 20
    })
    const text = container.textContent ?? ''
    expect(text).toContain('资源与描述不符')
    expect(text).toContain('等待处理方')
    expect(text).toContain('2 人报告')
    expect(text).toContain('资源X（条目A）')
    expect(text).toContain('正文预览内容')
    expect(container.querySelector('a[href="/issue/1"]')).not.toBeNull()
  })

  it('switches tabs, filters status (omitted when unset), and paginates', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([listItem()], 40))
    const container = await mount(<CaseTabsContainer />)
    await flush()

    // 切到「待我处理」：page 重置
    const ownedTab = [...container.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent === '待我处理'
    )!
    await act(async () => {
      ;(ownedTab as HTMLElement).click()
    })
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/case', {
      tab: 'owned',
      page: 1,
      limit: 20
    })

    // 选择状态后才带 status 参数
    const statusSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="按状态筛选"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLSelectElement.prototype,
        'value'
      )!.set!.call(statusSelect, 'resolved')
      statusSelect.dispatchEvent(
        new dom!.window.Event('change', { bubbles: true })
      )
    })
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/case', {
      tab: 'owned',
      status: 'resolved',
      page: 1,
      limit: 20
    })

    // 翻页
    const nextPage = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '下一页'
    )!
    await act(async () => {
      nextPage.click()
    })
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/case', {
      tab: 'owned',
      status: 'resolved',
      page: 2,
      limit: 20
    })
  })

  it('shows empty state and error retry', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    const container = await mount(<CaseTabsContainer />)
    await flush()
    expect(container.textContent).toContain('空空如也')

    mocks.kunFetchGet.mockResolvedValue('请先登录')
    const retryProbe = [...container.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent === '我关注的'
    )!
    await act(async () => {
      ;(retryProbe as HTMLElement).click()
    })
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '请先登录'
    )

    mocks.kunFetchGet.mockResolvedValue(listResponse([listItem()]))
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '重试'
    )!
    await act(async () => {
      retry.click()
    })
    await flush()
    expect(container.textContent).toContain('资源X（条目A）')
  })
})
