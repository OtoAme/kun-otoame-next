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
vi.mock('~/components/dashboard/ui/select', async () => {
  const ReactModule = await import('react')
  const Ctx = ReactModule.createContext<{
    value: string
    onValueChange?: (value: string) => void
  }>({ value: '' })
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value?: string
      onValueChange?: (value: string) => void
      children?: React.ReactNode
    }) => (
      <Ctx.Provider value={{ value: value ?? '', onValueChange }}>
        <div>{children}</div>
      </Ctx.Provider>
    ),
    SelectTrigger: ({
      'aria-labelledby': ariaLabelledby,
      className
    }: {
      children?: React.ReactNode
      'aria-labelledby'?: string
      className?: string
    }) => {
      const ctx = ReactModule.useContext(Ctx)
      return (
        <select
          aria-labelledby={ariaLabelledby}
          className={className}
          value={ctx.value}
          onChange={(event) => ctx.onValueChange?.(event.target.value)}
        />
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
    }) => {
      const ctx = ReactModule.useContext(Ctx)
      return (
        <option value={value} data-parent-value={ctx.value}>
          {children}
        </option>
      )
    }
  }
})

import { WorkspaceResources } from '~/components/dashboard/workspace/WorkspaceResources'

const list = (): WorkspaceResourcesResponse => ({
  items: [
    {
      id: 9,
      patchId: 3,
      patchUniqueId: 'game',
      patchName: '游戏甲',
      patchBanner: 'https://img.example/game.avif',
      name: 'https://example.com/' + 'a'.repeat(80),
      section: 'galgame',
      type: ['pc', 'chinese'],
      language: ['zh-Hans'],
      platform: ['windows'],
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
      patchBanner: '',
      name: '待审资源',
      section: 'patch',
      type: ['patch'],
      language: ['zh-Hans'],
      platform: ['windows'],
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

  const mount = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/workspace/resources'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal(
      'getComputedStyle',
      dom.window.getComputedStyle.bind(dom.window)
    )
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0)
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<WorkspaceResources />)
    })
    await act(async () => {})
    return container
  }

  it('lists own resources as cover cards and mounts the maintenance list in a tab', async () => {
    const container = await mount()

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
    expect(
      container.querySelectorAll('section[aria-label="链接维护"]')
    ).toHaveLength(1)
    expect(container.textContent).toContain('待处理 4')
    expect(
      container.querySelector('a[href="/workspace/resources/9"]')?.textContent
    ).toBe('编辑')
    expect(
      container.querySelector('a[href="/workspace/resources/10"]')?.textContent
    ).toBe('查看')
    expect(container.textContent).toContain('正常')
    expect(container.textContent).toContain('待审核')
    // Cover card layout: game name as title, resource name as subtitle
    const card = container
      .querySelector('a[href="/workspace/resources/9"]')!
      .closest('li') as HTMLElement
    expect(card.querySelector('h2')?.textContent).toBe('游戏甲')
    expect(card.textContent).toContain('https://example.com/')
    expect(card.textContent).toContain('PC游戏')
    expect(card.textContent).toContain('民汉')
    expect(card.textContent).toContain('简体中文')
    expect(card.textContent).toContain('Windows')
    expect(card.textContent).toContain('游戏资源')
    expect(card.textContent).toContain('2 条链接')
    expect(card.textContent).toContain('1 条待处理')
    // The cover uses the mini.avif convention and does not navigate
    const banner = card.querySelector('img') as HTMLImageElement
    expect(banner.getAttribute('src')).toBe(
      'https://img.example/game-mini.avif'
    )
    expect(banner.closest('a')).toBeNull()
    // Empty banner falls back to the site placeholder
    const secondCard = container
      .querySelector('a[href="/workspace/resources/10"]')!
      .closest('li') as HTMLElement
    expect(
      (secondCard.querySelector('img') as HTMLImageElement).getAttribute('src')
    ).toBe('/otoame.avif')
  })

  it('uses tabs for resources and maintenance with resources as the default', async () => {
    const container = await mount()
    const triggers = [
      ...container.querySelectorAll('[data-slot="tabs-trigger"]')
    ]
    expect(triggers.map((node) => node.textContent)).toEqual([
      '资源列表',
      '链接维护'
    ])
    const resourcesPanel = container.querySelector(
      '[data-slot="tabs-content"][data-state="active"]'
    )
    expect(resourcesPanel?.textContent).toContain('游戏甲')
    const maintenancePanel = [
      ...container.querySelectorAll('[data-slot="tabs-content"]')
    ].find((node) => node.getAttribute('data-state') !== 'active')
    // Inactive panels stay mounted but hidden, so filters survive tab switches
    expect(maintenancePanel?.className).toContain(
      'data-[state=inactive]:hidden'
    )
    // Both panels stay mounted: switching tabs does not reset either side
    await act(async () => {
      ;(triggers[1] as HTMLElement).click()
    })
    await act(async () => {
      ;(triggers[0] as HTMLElement).click()
    })
    expect(container.textContent).toContain('游戏甲')
    expect(
      container.querySelectorAll('section[aria-label="链接维护"]')
    ).toHaveLength(1)
  })

  it('labels a banned resource as 已封禁 and hides unknown stats', async () => {
    mocks.kunFetchGet.mockImplementation((url: string) => {
      if (url === '/workspace/maintenance') {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          limit: 20
        })
      }
      return Promise.resolve(
        (() => {
          const next = list()
          next.items[1] = { ...next.items[1]!, status: 1 }
          return next
        })()
      )
    })
    const container = await mount()
    expect(container.textContent).toContain('已封禁')
    expect(container.textContent).not.toContain('已隐藏')
    expect(container.textContent).not.toContain('待处理 0')
  })

  it('ignores a stale resource status response, including its loading and error', async () => {
    const resolvers: Array<
      (value: WorkspaceResourcesResponse | string) => void
    > = []
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
    const container = await mount()
    expect(container.textContent).toContain('正在加载资源')
    const select = [...container.querySelectorAll('select')].find(
      (node) =>
        node.getAttribute('aria-labelledby') ===
        'workspace-resource-status-label'
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

  it('separates failure from empty results', async () => {
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
      return Promise.resolve('列表接口故障')
    })
    const container = await mount()
    expect(container.textContent).toContain('列表接口故障')
    expect(container.textContent).not.toContain('没有符合条件的资源')
  })

  it('shows a new banner after the previous image failed on the same card', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/workspace/resources'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const { WorkspaceBanner } = await import(
      '~/components/dashboard/workspace/WorkspaceBanner'
    )
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    const show = async (banner: string) => {
      await act(async () => {
        root!.render(<WorkspaceBanner banner={banner} alt="封面" />)
      })
    }
    await show('https://img.example/a.avif')
    const first = container.querySelector('img') as HTMLImageElement
    expect(first.getAttribute('src')).toBe('https://img.example/a-mini.avif')
    await act(async () => {
      first.dispatchEvent(new dom!.window.Event('error'))
    })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/otoame.avif'
    )
    await show('https://img.example/b.avif')
    const next = container.querySelector('img') as HTMLImageElement
    expect(next.getAttribute('src')).toBe('https://img.example/b-mini.avif')
    await act(async () => {
      next.dispatchEvent(new dom!.window.Event('error'))
    })
    const fallback = container.querySelector('img') as HTMLImageElement
    expect(fallback.getAttribute('src')).toBe('/otoame.avif')
    await act(async () => {
      fallback.dispatchEvent(new dom!.window.Event('error'))
    })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/otoame.avif'
    )
  })
})
