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
  push: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: mocks.kunFetchPost
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
        bannerUrl: null,
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

  const button = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes(text)
    )

  it('shows quota, edits drafts, and withdraws a pending submission', async () => {
    const container = await mount()
    expect(container.textContent).toContain('可用萌萌点 30')
    expect(container.textContent).toContain('暂扣中 20')
    expect(container.textContent).toContain('进行中 1 / 3')
    expect(container.querySelector('a[href="/submission/15"]')?.textContent).toContain(
      '继续编辑'
    )
    expect(container.querySelector('a[href="/edit/create"]')).toBeNull()

    await act(async () => {
      button(container, '撤回')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/patch-submission/16/withdraw')

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

  it('points published feedback at the patch page and keeps direct create separate', async () => {
    mocks.kunFetchGet.mockImplementation((url: string, params: { view: string }) =>
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
    expect(container.textContent).toContain(PUBLISHED_ENTRY_CORRECTION_NOTICE)
    expect(container.textContent).toContain('已发布条目的修改申请暂未开放')
    const links = [...container.querySelectorAll('a[href="/game-one"]')].map(
      (link) => link.textContent
    )
    expect(links).toEqual(['查看', '反馈'])
    expect(container.textContent).not.toContain('在条目页查看并编辑')
    expect(container.querySelector('a[href="/edit/rewrite"]')).toBeNull()
    expect(container.querySelector('a[href^="/edit/rewrite"]')).toBeNull()
    expect(container.querySelector('a[href="/edit/create"]')?.textContent).toContain(
      '新建条目'
    )
    expect(button(container, '新建投稿')).toBeUndefined()
    expect(container.textContent).toContain('原有改写入口保持不变')
  })

  it('binds each administrator entry action to that row and not the bare editor', async () => {
    workspaceUser.role = 3
    mocks.kunFetchGet.mockImplementation((url: string, params: { view: string }) =>
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
              canCreateDirect: false,
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
    expect(container.textContent).not.toContain(PUBLISHED_ENTRY_CORRECTION_NOTICE)
    expect(container.textContent).not.toContain('修改申请暂未开放')
    expect(container.textContent).toContain('打开对应条目页查看并编辑')
    expect(container.querySelector('a[href="/edit/rewrite"]')).toBeNull()
    expect(container.querySelector('a[href^="/edit/rewrite"]')).toBeNull()
    const row = (name: string) =>
      [...container.querySelectorAll('li')].find(
        (item) => item.querySelector('h2')?.textContent === name
      )!
    const entryAction = (name: string) =>
      [...row(name).querySelectorAll('a')].find((link) =>
        link.textContent?.includes('在条目页查看并编辑')
      )
    expect(entryAction('已发布游戏')?.getAttribute('href')).toBe('/game-one')
    expect(entryAction('另一款游戏')?.getAttribute('href')).toBe('/game-two')
    expect(
      [...row('已发布游戏').querySelectorAll('a')].map((link) => link.textContent)
    ).toEqual(['查看', '反馈', '在条目页查看并编辑'])
    expect(container.querySelector('a[href="/edit/create"]')).toBeNull()
    expect(button(container, '新建投稿')).not.toBeUndefined()
  })

  it('keeps direct creation for role 4 while the entry action stays on its row', async () => {
    workspaceUser.role = 4
    mocks.kunFetchGet.mockResolvedValue(
      response({
        canCreateDirect: true,
        quota: null,
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
          }
        ]
      })
    )
    const container = await mount()
    expect(container.textContent).not.toContain(PUBLISHED_ENTRY_CORRECTION_NOTICE)
    const entryAction = [...container.querySelectorAll('a')].find((link) =>
      link.textContent?.includes('在条目页查看并编辑')
    )
    expect(entryAction?.getAttribute('href')).toBe('/game-one')
    expect(container.querySelector('a[href="/edit/rewrite"]')).toBeNull()
    expect(container.querySelector('a[href^="/edit/rewrite"]')).toBeNull()
    expect(container.querySelector('a[href="/edit/create"]')?.textContent).toContain(
      '新建条目'
    )
    expect(button(container, '新建投稿')).toBeUndefined()
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
