import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceResourcesResponse } from '~/types/api/workspace'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: vi.fn()
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/workspace/resources'
}))

import { WorkspaceResources } from '~/components/dashboard/workspace/WorkspaceResources'

const list = (): WorkspaceResourcesResponse => ({
  items: [
    {
      id: 9,
      patchId: 3,
      patchUniqueId: 'game',
      patchName: '游戏甲',
      name: 'https://example.com/' + 'a'.repeat(80),
      section: 'galgame',
      status: 0,
      created: '2026-10-01T00:00:00.000Z',
      linkCount: 2,
      actionableCount: 1,
      capabilities: { canEdit: true, canDelete: true, canUpload: false }
    },
    {
      id: 10,
      patchId: 3,
      patchUniqueId: 'game',
      patchName: '游戏甲',
      name: '待审资源',
      section: 'patch',
      status: 2,
      created: '2026-10-01T00:00:00.000Z',
      linkCount: 1,
      actionableCount: 0,
      capabilities: { canEdit: false, canDelete: false, canUpload: false }
    }
  ],
  total: 2,
  page: 1,
  limit: 20
})

describe('workspace resources', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.kunFetchGet.mockImplementation((url: string) => {
      if (url === '/workspace/maintenance') {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          limit: 20,
          actionableCount: 4
        })
      }
      return Promise.resolve(list())
    })
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

  it('lists own resources and mounts the single maintenance list', async () => {
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
      root!.render(<WorkspaceResources />)
    })
    await act(async () => {})

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/workspace/resources', {
      page: 1,
      limit: 20,
      status: 'all',
      section: 'all'
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledWith(
      '/workspace/maintenance',
      expect.objectContaining({ view: 'feedback', page: 1, limit: 20 })
    )
    expect(container.querySelectorAll('section[aria-label="链接维护"]')).toHaveLength(
      1
    )
    expect(container.textContent).toContain('待处理 4')
    expect(container.querySelector('a[href="/workspace/resources/9"]')?.textContent).toBe(
      '编辑'
    )
    expect(container.querySelector('a[href="/workspace/resources/10"]')?.textContent).toBe(
      '查看'
    )
    expect(container.textContent).toContain('正常')
    expect(container.textContent).toContain('待审核')
    const title = container.querySelector('h2')!
    expect(title.className).toContain('break-all')
    expect(title.textContent?.length).toBeGreaterThan(80)
  })

  it('ignores a stale resource status response, including its loading and error', async () => {
    const resolvers: Array<(value: WorkspaceResourcesResponse | string) => void> = []
    mocks.kunFetchGet.mockImplementation((url: string) => {
      if (url === '/workspace/maintenance') {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          limit: 20,
          actionableCount: 0
        })
      }
      return new Promise((resolve) => {
        resolvers.push(resolve)
      })
    })
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
      root!.render(<WorkspaceResources />)
    })
    expect(container.textContent).toContain('正在加载资源')
    const select = container.querySelector(
      'select[aria-label="资源状态"]'
    ) as HTMLSelectElement
    await act(async () => {
      select.value = 'pending'
      select.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
    expect(resolvers).toHaveLength(2)
    resolvers[0]!({
      ...list(),
      items: [{ ...list().items[0]!, name: '较旧资源' }]
    })
    await act(async () => {})
    expect(container.textContent).toContain('正在加载资源')
    expect(container.textContent).not.toContain('较旧资源')
    resolvers[1]!('状态筛选失败')
    await act(async () => {})
    expect(container.textContent).toContain('状态筛选失败')
    expect(container.textContent).not.toContain('较旧资源')
    expect(container.textContent).not.toContain('正在加载资源')
  })
})
