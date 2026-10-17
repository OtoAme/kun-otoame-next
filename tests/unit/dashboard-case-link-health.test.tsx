import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  kunFetchPost: vi.fn()
}))

vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('~/utils/kunFetch', () => ({ kunFetchPost: mocks.kunFetchPost }))

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

import { LinkHealthCaseActions } from '~/components/dashboard/case/LinkHealthCaseActions'
import { readCaseLinkHealth } from '~/components/case/linkHealthActionFlow'
import type { LinkHealthView } from '~/types/api/linkHealth'

globalThis.React = React

const view = (overrides: Partial<LinkHealthView> = {}): LinkHealthView => ({
  patchId: 3,
  resourceId: 7,
  linkId: 21,
  version: 2,
  evidenceRound: 1,
  health: 'disputed',
  healthChangedAt: '2026-10-08T00:00:00.000Z',
  verifiedAt: null,
  lastRelinkAt: null,
  ownerType: 'staff',
  disputeSource: 'owner_verification',
  recentReportCount: 4,
  latestCheck: null,
  capabilities: {
    ownerActions: [],
    resolveActions: ['available', 'broken'],
    canCheck: false,
    canEdit: false
  },
  ...overrides
})

const mutationResponse = (v: LinkHealthView) => ({
  link: v,
  changed: true
})

describe('LinkHealthCaseActions (case detail link actions)', () => {
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
    return container
  }

  const findExactButton = (scope: ParentNode, text: string) =>
    [...scope.querySelectorAll('button')].find(
      (button) => button.textContent === text
    )

  it('renders nothing when every capability is absent', async () => {
    const container = await mount(
      <LinkHealthCaseActions
        linkHealth={view({
          capabilities: {
            ownerActions: [],
            resolveActions: [],
            canCheck: false,
            canEdit: false
          }
        })}
        onChanged={vi.fn()}
      />
    )
    expect(container.querySelector('[aria-label="链接处理"]')).toBeNull()
  })

  it('hides unsupported detection while preserving independent owner actions', async () => {
    const container = await mount(
      <LinkHealthCaseActions
        linkHealth={view({
          health: 'suspect',
          capabilities: { ownerActions: ['verify'], resolveActions: [], canCheck: false, canEdit: true },
          latestCheck: {
            verdict: 'available', provider: 'quark', reason: 'share_available', failed: false,
            checkedAt: '2026-10-09T00:00:00.000Z', attemptedAt: '2026-10-09T00:00:00.000Z', stale: true
          }
        })}
        onChanged={vi.fn()}
      />
    )
    expect(findExactButton(container, '检测链接')).toBeUndefined()
    expect(findExactButton(container, '我已核实可用')).not.toBeUndefined()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it('posts the staff resolve with the full disputed basis after confirmation', async () => {
    const linkHealth = view()
    mocks.kunFetchPost.mockResolvedValue(mutationResponse(linkHealth))
    const onChanged = vi.fn()
    const container = await mount(
      <LinkHealthCaseActions linkHealth={linkHealth} onChanged={onChanged} />
    )

    await act(async () => {
      findExactButton(container, '判定可用')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})

    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/admin/link-health/resolve',
      {
        patchId: 3,
        resourceId: 7,
        linkId: 21,
        linkVersion: 2,
        evidenceRound: 1,
        health: 'disputed',
        healthChangedAt: '2026-10-08T00:00:00.000Z',
        action: 'available'
      }
    )
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('posts owner verify for the publisher detail and keeps cancel write-free', async () => {
    const linkHealth = view({
      health: 'suspect',
      ownerType: 'publisher',
      disputeSource: null,
      capabilities: {
        ownerActions: ['verify', 'confirm_broken'],
        resolveActions: [],
        canCheck: true,
        canEdit: false
      }
    })
    mocks.kunFetchPost.mockResolvedValue(mutationResponse(linkHealth))
    const container = await mount(
      <LinkHealthCaseActions linkHealth={linkHealth} onChanged={vi.fn()} />
    )

    // 取消：零写入
    await act(async () => {
      findExactButton(container, '我已核实可用')!.click()
    })
    await act(async () => {
      findExactButton(container, '取消')!.click()
    })
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()

    await act(async () => {
      findExactButton(container, '我已核实可用')!.click()
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
        evidenceRound: 1,
        health: 'suspect',
        healthChangedAt: '2026-10-08T00:00:00.000Z',
        action: 'verify'
      }
    )
  })

  it('keeps the dialog open on transient failures (confirm拦下默认关)', async () => {
    mocks.kunFetchPost.mockResolvedValue('系统繁忙，请稍后重试')
    const container = await mount(
      <LinkHealthCaseActions linkHealth={view()} onChanged={vi.fn()} />
    )

    // 取消：零写入
    await act(async () => {
      findExactButton(container, '判定失效')!.click()
    })
    await act(async () => {
      findExactButton(container, '取消')!.click()
    })
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()

    // 临时失败：confirm 的 preventDefault 拦住 Radix 默认关，弹窗保持
    await act(async () => {
      findExactButton(container, '判定失效')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})
    expect(mocks.toast.error).toHaveBeenCalledWith('系统繁忙，请稍后重试')
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
  })

  it('surfaces named conflicts without resubmitting', async () => {
    mocks.kunFetchPost.mockResolvedValue('该链接的处理状态已变化，请刷新后重试')
    const container = await mount(
      <LinkHealthCaseActions linkHealth={view()} onChanged={vi.fn()} />
    )
    await act(async () => {
      findExactButton(container, '判定失效')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
    expect(mocks.toast.error).toHaveBeenCalledWith(
      '该链接的处理状态已变化，请刷新后重试'
    )
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })
})

describe('readCaseLinkHealth (guarded B-field reader)', () => {
  it('returns null for missing or malformed payloads', () => {
    expect(readCaseLinkHealth({})).toBeNull()
    expect(readCaseLinkHealth(null)).toBeNull()
    expect(readCaseLinkHealth({ linkHealth: null })).toBeNull()
    expect(readCaseLinkHealth({ linkHealth: { linkId: 1 } })).toBeNull()
    expect(
      readCaseLinkHealth({
        linkHealth: { linkId: 1, version: 2, capabilities: null }
      })
    ).toBeNull()
  })

  it('returns the view when the contracted fields exist', () => {
    const linkHealth = view()
    expect(readCaseLinkHealth({ linkHealth })).toBe(linkHealth)
  })
})
