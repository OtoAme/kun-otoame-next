import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.kunFetchGet }))
vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children?: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

// radix select/checkbox 内部依赖完整 DOM，本测试只看查询构造与展示
vi.mock('~/components/dashboard/ui/select', () => ({
  Select: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({
    children,
    'aria-label': ariaLabel
  }: {
    children?: React.ReactNode
    'aria-label'?: string
  }) => <button aria-label={ariaLabel}>{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
  SelectContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({
    children,
    value
  }: {
    children?: React.ReactNode
    value: string
  }) => <span data-value={value}>{children}</span>
}))
vi.mock('~/components/dashboard/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    'aria-label': ariaLabel
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    'aria-label'?: string
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  )
}))

import { LinkHealthAdminClient } from '~/components/dashboard/link-health/LinkHealthAdminClient'
import type {
  AdminLinkHealthListResponse,
  LinkHealthListRow
} from '~/types/api/linkHealth'

globalThis.React = React

const row = (
  overrides: Partial<LinkHealthListRow> = {}
): LinkHealthListRow => ({
  patchId: 3,
  resourceId: 7,
  linkId: 21,
  version: 2,
  evidenceRound: 1,
  health: 'broken',
  healthChangedAt: '2026-10-08T00:00:00.000Z',
  verifiedAt: null,
  lastRelinkAt: null,
  ownerType: 'staff',
  disputeSource: null,
  recentReportCount: 4,
  latestCheck: null,
  capabilities: {
    ownerActions: [],
    resolveActions: [],
    canCheck: false,
    canEdit: true
  },
  patch: { uniqueId: 'abc12345', name: '条目A' },
  resource: { name: '资源X', section: 'galgame' },
  storage: 'touchgal',
  size: '2 GB',
  hostname: 'pan.example.com',
  brokenForSeconds: 86400 * 3,
  caseId: 44,
  ...overrides
})

const listResponse = (
  rows: LinkHealthListRow[] = [row()],
  total = rows.length
): AdminLinkHealthListResponse => ({
  items: rows,
  total,
  page: 1,
  limit: 20,
  trackingStartedAt: '2026-10-01T00:00:00.000Z',
  hosts: [
    { hostname: 'pan.example.com', totalLinks: 100, brokenLinks: 4 },
    { hostname: null, totalLinks: 10, brokenLinks: 1 }
  ]
})

describe('dashboard read-only link-health view (M04-5)', () => {
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
    act(() => {
      root?.unmount()
    })
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    await act(async () => {})
    return container
  }

  const findButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(text)
    )

  it('loads the broken-link snapshot and renders hosts ratio with the tracking start', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse())
    const container = await mount(<LinkHealthAdminClient />)

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/link-health', {
      page: 1,
      limit: 20
    })
    const text = container.textContent ?? ''
    expect(text).toContain('已失效链接')
    expect(text).toContain('pan.example.com')
    expect(text).toContain('4/100')
    expect(text).toContain('1/10')
    expect(text).toContain('统计自')
    expect(text).toContain('当前健康快照')
    expect(text).toContain('条目A')
    expect(text).toContain('资源X')
    expect(text).toContain('3 天')
    expect(text).not.toContain('https://')
    expect(
      container.querySelector('a[href="/dashboard/case/44"]')?.textContent
    ).toContain('事项 #44')
  })

  it('applies hostname filters on submit and paginates with the standing query', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([row()], 40))
    const container = await mount(<LinkHealthAdminClient />)

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="网盘主机"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, 'Pan.EXAMPLE.com')
      input.dispatchEvent(new dom!.window.Event('input', { bubbles: true }))
    })
    await act(async () => {
      findButton(container, '应用筛选')!.click()
    })
    await act(async () => {})

    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/link-health', {
      page: 1,
      limit: 20,
      hostname: 'pan.example.com'
    })

    await act(async () => {
      findButton(container, '下一页')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/link-health', {
      page: 2,
      limit: 20,
      hostname: 'pan.example.com'
    })
  })

  it('sends otherHost instead of a hostname when the other-host box is checked', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse())
    const container = await mount(<LinkHealthAdminClient />)

    await act(async () => {
      container
        .querySelector<HTMLInputElement>('input[aria-label="只看无法解析主机"]')!
        .click()
    })
    await act(async () => {
      findButton(container, '应用筛选')!.click()
    })
    await act(async () => {})

    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/link-health', {
      page: 1,
      limit: 20,
      otherHost: 'true'
    })
  })

  it('shows load errors with retry and never fabricates durations', async () => {
    mocks.kunFetchGet.mockResolvedValue('您没有权限操作该链接')
    const container = await mount(<LinkHealthAdminClient />)
    expect(container.textContent).toContain('您没有权限操作该链接')
    expect(findButton(container, '重试')).not.toBeUndefined()

    mocks.kunFetchGet.mockResolvedValue(
      listResponse([row({ brokenForSeconds: null, healthChangedAt: null })])
    )
    await act(async () => {
      findButton(container, '重试')!.click()
    })
    await act(async () => {})
    expect(container.textContent).toContain('未知')
  })
})
