import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn()
}))

vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
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

// 确认流与 close 语义是目标行为（RUI-03）：模拟 Radix 的默认点击即关——
// 只有产品侧 preventDefault 才能拦住同次关闭
vi.mock('~/components/dashboard/ui/alert-dialog', () => {
  let closeSignal: (() => void) | null = null
  const closeNow = () => closeSignal?.()
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children
    }: {
      open: boolean
      onOpenChange?: (open: boolean) => void
      children?: React.ReactNode
    }) => {
      closeSignal = () => onOpenChange?.(false)
      return open ? <div role="alertdialog">{children}</div> : null
    },
    AlertDialogContent: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogCancel: ({
      children,
      disabled
    }: {
      children?: React.ReactNode
      disabled?: boolean
    }) => (
      <button disabled={disabled} onClick={closeNow}>
        {children}
      </button>
    ),
    AlertDialogAction: ({
      children,
      disabled,
      onClick
    }: {
      children?: React.ReactNode
      disabled?: boolean
      onClick?: (event: { preventDefault: () => void }) => void
    }) => (
      <button
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented) closeNow()
        }}
      >
        {children}
      </button>
    )
  }
})

import { IssueLinkRepairList } from '~/components/dashboard/issue/IssueLinkRepairList'
import { useLinkRepairList } from '~/components/dashboard/issue/useLinkRepairList'
import type {
  LinkHealthListResponse,
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
  evidenceRound: 0,
  health: 'suspect',
  healthChangedAt: '2026-10-08T00:00:00.000Z',
  verifiedAt: null,
  lastRelinkAt: null,
  ownerType: 'publisher',
  disputeSource: null,
  recentReportCount: 3,
  latestCheck: null,
  capabilities: {
    ownerActions: ['verify', 'confirm_broken'],
    resolveActions: [],
    canCheck: false,
    canEdit: true
  },
  patch: { uniqueId: 'abc12345', name: '条目A' },
  resource: { name: '资源X', section: 'galgame' },
  storage: 'user',
  size: '2 GB',
  hostname: 'pan.example.com',
  brokenForSeconds: null,
  caseId: 44,
  ...overrides
})

const listResponse = (
  rows: LinkHealthListRow[] = [row()]
): LinkHealthListResponse => ({
  items: rows,
  total: rows.length,
  page: 1,
  limit: 10
})

const Harness = () => {
  const repair = useLinkRepairList(true)
  return <IssueLinkRepairList repair={repair} />
}

describe('issue link repair list (M04-5 链接待修复)', () => {
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

  const findButton = (scope: ParentNode, text: string) =>
    [...scope.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(text)
    )

  /** 精确匹配按钮文本，避免「确认」命中「确认失效」。 */
  const findExactButton = (scope: ParentNode, text: string) =>
    [...scope.querySelectorAll('button')].find(
      (button) => button.textContent === text
    )

  it('fetches only my non-ok links and renders each row with its relink href', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse())
    const container = await mount(<Harness />)

    expect(mocks.kunFetchGet).toHaveBeenCalledWith(
      '/patch/resource/link/health',
      { page: 1, limit: 10 }
    )
    const text = container.textContent ?? ''
    expect(text).toContain('链接待修复')
    expect(text).toContain('疑似失效')
    expect(text).toContain('资源X')
    expect(text).toContain('条目A')
    expect(
      [...container.querySelectorAll('a')].find((anchor) =>
        anchor.textContent?.includes('去补链')
      )?.getAttribute('href')
    ).toBe(
      '/abc12345?tab=resources&resourceSection=galgame&resourceId=7'
    )
  })

  it('posts a verified basis after confirmation, and writes nothing on cancel', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse())
    const container = await mount(<Harness />)

    // 取消：零写入
    await act(async () => {
      findButton(container, '我已核实可用')!.click()
    })
    await act(async () => {
      findExactButton(container, '取消')!.click()
    })
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()

    // 确认：携带完整期望基点
    mocks.kunFetchPost.mockResolvedValue({
      link: row({ health: 'ok' }),
      changed: true
    })
    await act(async () => {
      findButton(container, '我已核实可用')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})

    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/patch/resource/link/health',
      {
        patchId: 3,
        resourceId: 7,
        linkId: 21,
        linkVersion: 2,
        evidenceRound: 0,
        health: 'suspect',
        healthChangedAt: '2026-10-08T00:00:00.000Z',
        action: 'verify'
      }
    )
    // 提交后重新拉取待修复列表
    expect(
      mocks.kunFetchGet.mock.calls.filter(
        ([url]) => url === '/patch/resource/link/health'
      ).length
    ).toBeGreaterThanOrEqual(2)
    // 成功按结果显式关闭，不是同次点击的默认关
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('surfaces named errors verbatim and never closes the dialog mid-failure', async () => {
    mocks.kunFetchGet.mockResolvedValueOnce(listResponse())
    const container = await mount(<Harness />)

    // 业务失败（含具名冲突）：confirm 的 preventDefault 拦住默认关，弹窗保持，
    // 用户可取消或重试；取消依然零写入
    mocks.kunFetchPost.mockResolvedValue('该链接的处理状态已变化，请刷新后重试')
    await act(async () => {
      findButton(container, '确认失效')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})
    expect(mocks.toast.error).toHaveBeenCalledWith(
      '该链接的处理状态已变化，请刷新后重试'
    )
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => {
      findExactButton(container, '取消')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)

    // 列表加载失败也有错误与重试
    mocks.kunFetchGet.mockResolvedValueOnce('请先登录')
    await act(async () => {
      findButton(container, '刷新')!.click()
    })
    await act(async () => {})
    expect(container.textContent).toContain('请先登录')
    expect(findButton(container, '重试')).not.toBeUndefined()
  })

  it('renders the empty state for publishers with nothing to fix', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    const container = await mount(<Harness />)
    expect(container.textContent).toContain('没有需要修复的链接')
  })
})
