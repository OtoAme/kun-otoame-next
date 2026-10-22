import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUBLISHED_ENTRY_CORRECTION_NOTICE } from '~/constants/workspace'
import type { WorkspaceEntriesResponse } from '~/types/api/workspace'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn(),
  kunFetchPatch: vi.fn(),
  kunFetchDelete: vi.fn(),
  clearPatchSubmissionDraftStorage: vi.fn(),
  push: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: mocks.kunFetchPost,
  kunFetchPatch: mocks.kunFetchPatch,
  kunFetchDelete: mocks.kunFetchDelete
}))
vi.mock('~/utils/patchSubmissionUploadDraft', () => ({
  clearPatchSubmissionDraftStorage: mocks.clearPatchSubmissionDraftStorage
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() })
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
vi.mock('next/image', () => ({
  default: () => null
}))
// Native <select> for the status filter: options are collected through context.
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
      'aria-labelledby': ariaLabelledby,
      className
    }: {
      children?: React.ReactNode
      'aria-label'?: string
      'aria-labelledby'?: string
      className?: string
    }) => {
      const ctx = ReactModule.useContext(Ctx)
      return (
        <select
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          className={className}
          disabled={ctx.disabled}
          value={ctx.value}
          onChange={(event) => ctx.onValueChange?.(event.target.value)}
        >
          {ctx.options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
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
    SelectItem: () => null
  }
})
// Minimal dropdown-menu: trigger renders inline, items render as buttons.
vi.mock('~/components/dashboard/ui/dropdown-menu', () => {
  return {
    DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    DropdownMenuTrigger: ({
      children
    }: {
      children?: React.ReactNode
      asChild?: boolean
    }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="dropdown-content">{children}</div>
    ),
    DropdownMenuItem: ({
      children,
      onSelect
    }: {
      children?: React.ReactNode
      onSelect?: () => void
    }) => (
      <button type="button" onClick={() => onSelect?.()}>
        {children}
      </button>
    )
  }
})
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

import { WorkspaceEntries } from '~/components/dashboard/workspace/WorkspaceEntries'
import { WorkspaceUserProvider } from '~/components/dashboard/workspace/WorkspaceShell'

const workspaceUser = { id: 4, name: '作者', role: 1 }

const quota = {
  activeCount: 1,
  maxActive: 3,
  depositAmount: 30,
  usedBytes: 0,
  maxBytes: 100
}

const balance = { total: 50, reserved: 20, available: 30 }

const response = (
  overrides: Partial<WorkspaceEntriesResponse> = {}
): WorkspaceEntriesResponse => ({
  items: [
    {
      kind: 'submission',
      submission: {
        id: 15,
        status: 'draft',
        name: '草稿条目',
        heldAmount: 30,
        reviewReason: null,
        bannerUrl: 'https://img.example/draft.avif',
        patchUniqueId: null,
        submittedAt: null,
        created: '2026-10-01T00:00:00.000Z',
        updated: '2026-10-01T00:00:00.000Z'
      }
    },
    {
      kind: 'submission',
      submission: {
        id: 16,
        status: 'pending',
        name: '待审条目',
        heldAmount: 30,
        reviewReason: null,
        bannerUrl: null,
        patchUniqueId: null,
        submittedAt: '2026-10-02T00:00:00.000Z',
        created: '2026-10-01T00:00:00.000Z',
        updated: '2026-10-02T00:00:00.000Z'
      }
    }
  ],
  total: 2,
  page: 1,
  limit: 20,
  quota,
  moemoepointBalance: balance,
  canCreateDirect: false,
  ...overrides
})

describe('workspace entries', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    workspaceUser.role = 1
    mocks.kunFetchGet.mockResolvedValue(response())
    mocks.clearPatchSubmissionDraftStorage.mockResolvedValue(undefined)
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
      url: 'http://localhost/workspace/entries'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <WorkspaceUserProvider user={{ ...workspaceUser }}>
          <WorkspaceEntries />
        </WorkspaceUserProvider>
      )
    })
    await act(async () => {})
    return container
  }

  const button = (rootNode: ParentNode, text: string) =>
    [...rootNode.querySelectorAll('button')].find((item) =>
      item.textContent?.includes(text)
    )

  const cardTitles = (container: ParentNode) =>
    [...container.querySelectorAll('li h2')].map((item) => item.textContent)

  it('shows quota, edits drafts, and withdraws a pending submission', async () => {
    const container = await mount()
    expect(container.textContent).toContain('可用萌萌点 30')
    expect(container.textContent).toContain('暂扣中 20')
    expect(container.textContent).toContain('进行中 1 / 3')
    expect(
      container.querySelector('a[href="/submission/15"]')?.textContent
    ).toContain('继续编辑')
    expect(container.querySelector('a[href="/edit/create"]')).toBeNull()
    // 投稿卡片横幅沿用 mini 约定；缺图时回退默认图
    expect(
      container.querySelector('img[src="https://img.example/draft-mini.avif"]')
    ).not.toBeNull()
    const banners = [...container.querySelectorAll('img')].map(
      (image) => (image as HTMLImageElement).src
    )
    expect(banners).toContain('http://localhost/otoame.avif')

    await act(async () => {
      button(container, '撤回')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/patch-submission/16/withdraw'
    )
    // 审核中没有删除入口
    const pendingRow = [...container.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('待审条目')
    )!
    expect(button(pendingRow, '删除并返还')).toBeUndefined()
    expect(button(pendingRow, '更多')).toBeUndefined()

    mocks.kunFetchPost.mockResolvedValue({ submissionId: 21 })
    await act(async () => {
      button(container, '新建投稿')!.click()
    })
    await act(async () => {})
    const body = mocks.kunFetchPost.mock.calls.at(-1)?.[1] as {
      requestId: string
      payload: { name: string }
    }
    expect(mocks.kunFetchPost.mock.calls.at(-1)?.[0]).toBe('/patch-submission')
    expect(body.requestId).toMatch(/^[0-9a-f]{32}$/)
    expect(body.payload.name).toBe('未命名投稿')
    expect(mocks.push).toHaveBeenCalledWith('/submission/21')
  })

  it('deletes a draft with refund, clears its draft storage, and updates quota', async () => {
    const container = await mount()
    const draftRow = [...container.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('草稿条目')
    )!
    await act(async () => {
      button(draftRow, '删除并返还')!.click()
    })
    const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
    // 确认文案展示实际暂扣金额
    expect(dialog.textContent).toContain('暂扣的 30 萌萌点会返还')

    mocks.kunFetchDelete.mockResolvedValue({
      moemoepointBalance: { total: 50, reserved: 0, available: 60 }
    })
    mocks.kunFetchGet.mockResolvedValue(
      response({
        items: [
          {
            kind: 'submission',
            submission: {
              id: 16,
              status: 'pending',
              name: '待审条目',
              heldAmount: 30,
              reviewReason: null,
              bannerUrl: null,
              patchUniqueId: null,
              submittedAt: '2026-10-02T00:00:00.000Z',
              created: '2026-10-01T00:00:00.000Z',
              updated: '2026-10-02T00:00:00.000Z'
            }
          }
        ],
        total: 1,
        quota: { ...quota, activeCount: 0 },
        moemoepointBalance: { total: 90, reserved: 10, available: 80 }
      })
    )
    await act(async () => {
      button(dialog, '删除并返还')!.click()
    })
    await act(async () => {})
    await act(async () => {})
    expect(mocks.kunFetchDelete).toHaveBeenCalledWith('/patch-submission/15')
    expect(mocks.clearPatchSubmissionDraftStorage).toHaveBeenCalledWith(15)
    expect(cardTitles(container)).not.toContain('草稿条目')
    expect(container.textContent).toContain('可用萌萌点 80')
    expect(container.textContent).toContain('暂扣中 10')
    expect(container.textContent).toContain('进行中 0 / 3')
  })

  it('keeps the card when deletion fails and shows the error inside the dialog', async () => {
    const container = await mount()
    const draftRow = [...container.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('草稿条目')
    )!
    await act(async () => {
      button(draftRow, '删除并返还')!.click()
    })
    mocks.kunFetchDelete.mockResolvedValue('投稿已被处理，不能删除')
    const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
    await act(async () => {
      button(dialog, '删除并返还')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchDelete).toHaveBeenCalledWith('/patch-submission/15')
    expect(mocks.clearPatchSubmissionDraftStorage).not.toHaveBeenCalled()
    // 失败时卡片保留，错误显示在弹窗内
    expect(container.textContent).toContain('草稿条目')
    const stillOpen = dom!.window.document.querySelector(
      '[role="alertdialog"]'
    )!
    expect(stillOpen.textContent).toContain('投稿已被处理，不能删除')
  })

  it('does not resurrect a deleted card when a stale refresh resolves later', async () => {
    const container = await mount()
    // 挂起下一次刷新，先删再放出旧数据
    let resolveStale: ((value: WorkspaceEntriesResponse) => void) | undefined
    mocks.kunFetchGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve
        })
    )
    mocks.kunFetchDelete.mockResolvedValue({
      moemoepointBalance: { total: 50, reserved: 0, available: 60 }
    })
    const draftRow = [...container.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('草稿条目')
    )!
    await act(async () => {
      button(draftRow, '删除并返还')!.click()
    })
    const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
    await act(async () => {
      button(dialog, '删除并返还')!.click()
    })
    await act(async () => {})
    expect(cardTitles(container)).not.toContain('草稿条目')
    // 迟到的旧列表仍然包含 15，也不能把卡片带回来
    resolveStale!(response())
    await act(async () => {})
    expect(cardTitles(container)).not.toContain('草稿条目')
    expect(container.textContent).toContain('可用萌萌点 60')
    expect(container.textContent).toContain('暂扣中 0')
    expect(container.textContent).toContain('进行中 0 / 3')
    expect(container.textContent).not.toContain('进行中 1 / 3')
  })

  it('keeps the deleted card gone and the refunded balance when refresh fails', async () => {
    const container = await mount()
    mocks.kunFetchDelete.mockResolvedValue({
      moemoepointBalance: { total: 50, reserved: 0, available: 60 }
    })
    mocks.kunFetchGet.mockRejectedValueOnce(new Error('offline'))
    const draftRow = [...container.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('草稿条目')
    )!
    await act(async () => {
      button(draftRow, '删除并返还')!.click()
    })
    const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
    await act(async () => {
      button(dialog, '删除并返还')!.click()
    })
    await act(async () => {})
    await act(async () => {})
    expect(cardTitles(container)).not.toContain('草稿条目')
    expect(container.textContent).toContain('可用萌萌点 60')
    expect(container.textContent).toContain('进行中 0 / 3')
    expect(container.textContent).toContain('网络错误，列表加载失败，请重试')
    expect(container.textContent).not.toContain('没有符合条件的条目')
  })

  it('shows a login failure when creating a draft is rejected', async () => {
    const container = await mount()
    mocks.kunFetchPost.mockRejectedValueOnce(
      new Error('Kun Fetch error! Status: 401')
    )
    await act(async () => {
      button(container, '新建投稿')!.click()
    })
    await act(async () => {})
    expect(container.textContent).toContain('登录已失效，请重新登录后再试')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('hides a rejected submission locally without touching balance or draft storage', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      response({
        items: [
          {
            kind: 'submission',
            submission: {
              id: 17,
              status: 'rejected',
              name: '被驳回条目',
              heldAmount: 0,
              reviewReason: '简介不合规',
              bannerUrl: null,
              patchUniqueId: null,
              submittedAt: '2026-10-02T00:00:00.000Z',
              created: '2026-10-01T00:00:00.000Z',
              updated: '2026-10-02T00:00:00.000Z'
            }
          }
        ],
        total: 1
      })
    )
    mocks.kunFetchPatch.mockResolvedValue({})
    const container = await mount()
    const row = [...container.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('被驳回条目')
    )!
    expect(
      row.querySelector('a[href="/submission/17"]')?.textContent
    ).toContain('查看')
    expect(button(row, '撤回')).toBeUndefined()
    expect(button(row, '删除并返还')).toBeUndefined()
    await act(async () => {
      button(row, '从列表隐藏')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPatch).toHaveBeenCalledWith('/patch-submission/17', {})
    expect(mocks.kunFetchDelete).not.toHaveBeenCalled()
    expect(mocks.clearPatchSubmissionDraftStorage).not.toHaveBeenCalled()
    expect(cardTitles(container)).not.toContain('被驳回条目')
    expect(container.textContent).toContain('可用萌萌点 30')
  })

  it('keeps a rejected card and shows an error when hiding fails', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      response({
        items: [
          {
            kind: 'submission',
            submission: {
              id: 17,
              status: 'rejected',
              name: '被驳回条目',
              heldAmount: 0,
              reviewReason: '简介不合规',
              bannerUrl: null,
              patchUniqueId: null,
              submittedAt: '2026-10-02T00:00:00.000Z',
              created: '2026-10-01T00:00:00.000Z',
              updated: '2026-10-02T00:00:00.000Z'
            }
          }
        ],
        total: 1
      })
    )
    mocks.kunFetchPatch.mockRejectedValueOnce(new Error('offline'))
    const container = await mount()
    const row = [...container.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('被驳回条目')
    )!
    await act(async () => {
      button(row, '从列表隐藏')!.click()
    })
    await act(async () => {})
    expect(cardTitles(container)).toContain('被驳回条目')
    expect(container.textContent).toContain('隐藏失败，请稍后重试')
    expect(container.textContent).toContain('可用萌萌点 30')
    expect(mocks.kunFetchDelete).not.toHaveBeenCalled()
    expect(mocks.clearPatchSubmissionDraftStorage).not.toHaveBeenCalled()
  })

  it('shows the published view with a single entry link and banner', async () => {
    mocks.kunFetchGet.mockImplementation(
      (url: string, params: { view: string }) =>
        Promise.resolve(
          params.view === 'published'
            ? response({
                items: [
                  {
                    kind: 'published',
                    patch: {
                      id: 3,
                      uniqueId: 'game-one',
                      name: '已发布游戏',
                      banner: 'https://img.example/game.avif',
                      status: 0,
                      created: '2026-10-01T00:00:00.000Z'
                    }
                  }
                ],
                total: 1,
                canCreateDirect: true,
                quota: null
              })
            : response()
        )
    )
    const container = await mount()
    await act(async () => {
      button(container, '已发布')!.click()
    })
    await act(async () => {})
    // 普通作者的修改提示只在已发布视图出现一次，不跟随每张卡片
    expect(
      container.textContent?.split(PUBLISHED_ENTRY_CORRECTION_NOTICE).length
    ).toBe(2)
    const links = [...container.querySelectorAll('a[href="/game-one"]')].map(
      (link) => link.textContent
    )
    expect(links).toEqual(['查看条目'])
    // 卡片自身只有单一入口；提示文案里的“条目反馈”不属于卡片操作
    const cardRow = [...container.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('已发布游戏')
    )!
    expect(cardRow.textContent).not.toContain('反馈')
    expect(cardRow.textContent).not.toContain('在条目页查看并编辑')
    expect(
      container.querySelector('img[src="https://img.example/game-mini.avif"]')
    ).not.toBeNull()
    expect(container.querySelector('a[href^="/edit/rewrite"]')).toBeNull()
    expect(
      container.querySelector('a[href="/edit/create"]')?.textContent
    ).toContain('新建条目')
    expect(button(container, '新建投稿')).toBeUndefined()
    expect(container.textContent).toContain('原有改写入口保持不变')
  })

  it('keeps the same single entry link for administrators', async () => {
    workspaceUser.role = 3
    mocks.kunFetchGet.mockImplementation(
      (url: string, params: { view: string }) =>
        Promise.resolve(
          params.view === 'published'
            ? response({
                items: [
                  {
                    kind: 'published',
                    patch: {
                      id: 3,
                      uniqueId: 'game-one',
                      name: '已发布游戏',
                      banner: '',
                      status: 0,
                      created: '2026-10-01T00:00:00.000Z'
                    }
                  },
                  {
                    kind: 'published',
                    patch: {
                      id: 4,
                      uniqueId: 'game-two',
                      name: '另一款游戏',
                      banner: '',
                      status: 0,
                      created: '2026-10-02T00:00:00.000Z'
                    }
                  }
                ],
                total: 2,
                quota
              })
            : response()
        )
    )
    const container = await mount()
    await act(async () => {
      button(container, '已发布')!.click()
    })
    await act(async () => {})
    expect(container.textContent).not.toContain(
      PUBLISHED_ENTRY_CORRECTION_NOTICE
    )
    const row = (name: string) =>
      [...container.querySelectorAll('li')].find(
        (item) => item.querySelector('h2')?.textContent === name
      )!
    const entryAction = (name: string) =>
      [...row(name).querySelectorAll('a')].map((link) => ({
        text: link.textContent,
        href: link.getAttribute('href')
      }))
    expect(entryAction('已发布游戏')).toEqual([
      { text: '查看条目', href: '/game-one' }
    ])
    expect(entryAction('另一款游戏')).toEqual([
      { text: '查看条目', href: '/game-two' }
    ])
    expect(container.textContent).not.toContain('反馈')
    expect(container.querySelector('a[href^="/edit/rewrite"]')).toBeNull()
  })

  it('filters submissions without published or deleted options', async () => {
    const container = await mount()
    const select = container.querySelector(
      'select[aria-label="投稿状态"]'
    ) as HTMLSelectElement
    const options = [...select.options].map((option) => option.value)
    expect(options).toEqual([
      'all',
      'draft',
      'pending',
      'changes_requested',
      'rejected',
      'violation'
    ])
    expect(options).not.toContain('published')
    expect(options).not.toContain('deleted')
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(
        dom!.window.HTMLSelectElement.prototype,
        'value'
      )
      proto?.set?.call(select, 'rejected')
      select.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
    await act(async () => {})
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith(
      '/workspace/entries',
      expect.objectContaining({ view: 'submissions', status: 'rejected' })
    )
  })

  it('ignores a stale entries response, including its loading and error', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    mocks.kunFetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        })
    )
    const container = await mount()
    expect(container.textContent).toContain('正在加载条目')
    await act(async () => {
      button(container, '已发布')!.click()
    })
    expect(resolvers).toHaveLength(2)
    resolvers[0]!(response())
    await act(async () => {})
    expect(container.textContent).toContain('正在加载条目')
    expect(container.textContent).not.toContain('草稿条目')
    resolvers[1]!('筛选结果加载失败')
    await act(async () => {})
    expect(container.textContent).toContain('筛选结果加载失败')
    expect(container.textContent).not.toContain('草稿条目')
    expect(container.textContent).not.toContain('正在加载条目')
  })
})
