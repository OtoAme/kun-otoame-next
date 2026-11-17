import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet
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

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    as: _as,
    color: _color,
    endContent: _endContent,
    variant: _variant,
    ...props
  }: {
    children?: React.ReactNode
    [key: string]: unknown
  }) => <button {...props}>{children}</button>
}))

vi.mock('~/components/home/hero/HomeHero', () => ({
  HomeHero: () => <div data-testid="home-hero" />
}))

// The shoutbox home module has its own behavior tests; stub it out so its
// client-side fetch and boundary timers never interfere with this suite.
vi.mock('~/components/shoutbox/ShoutboxHomeSection', () => ({
  ShoutboxHomeSection: () => null
}))

vi.mock('~/components/resource/ResourceCard', () => ({
  ResourceCard: ({ resource }: { resource: { id: number; name: string } }) => (
    <article data-testid="resource-card">{resource.name}</article>
  )
}))

vi.mock('~/components/galgame/Card', () => ({
  GalgameCard: ({ patch }: { patch: GalgameCard }) => (
    <article data-testid="galgame-card">
      {patch.uniqueId}:{patch.view}:{patch.download}
    </article>
  )
}))

const makeGalgame = (): GalgameCard => ({
  id: 1,
  uniqueId: 'abc12345',
  name: 'Otome',
  banner: '/banner.webp',
  view: 10,
  download: 2,
  type: ['game'],
  language: ['zh-cn'],
  platform: ['windows'],
  tags: [],
  created: '2026-01-01T00:00:00.000Z',
  _count: {
    favorite_folder: 0,
    resource: 0,
    comment: 0
  },
  averageRating: 0
})

const makeGalgames = (count: number): GalgameCard[] =>
  Array.from({ length: count }, (_, index) => ({
    ...makeGalgame(),
    id: index + 1,
    uniqueId: `game${String(index).padStart(4, '0')}`
  }))

describe('HomeContainer personalized results', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined
  const renderHome = async (
    status: 'guest' | 'checking' | 'authenticated' = 'authenticated',
    strict = false
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { useUserStore } = await import('~/store/userStore')
    useUserStore.setState({
      sessionStatus: status,
      user: { ...useUserStore.getState().user, uid: 7 },
      sessionContext: 'first-context',
      sessionGeneration: 0
    })
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    usePreferenceStore.setState({
      generation: 0,
      status: 'ready',
      applied: {
        uid: 7,
        context: 'first-context',
        version: 0,
        nsfwSelected: false,
        blockedTagIds: [],
        items: {
          nsfw: { value: 'sfw', version: 0 },
          'email-notice': { value: false, version: 0 }
        }
      }
    })
    const { HomeContainer } = await import('~/components/home/Container')
    const container = document.getElementById('root')!
    root = createRoot(container)
    const element = (
      <HomeContainer
        galgames={makeGalgames(24)}
        resources={[
          {
            id: 9,
            name: 'public static resource'
          } as import('~/types/api/home').HomeResource
        ]}
      />
    )
    await act(async () => {
      root!.render(
        strict ? <React.StrictMode>{element}</React.StrictMode> : element
      )
    })
    return { container, useUserStore }
  }
  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    vi.unstubAllGlobals()
    vi.resetModules()
    fetchMock.kunFetchGet.mockReset()
  })
  it('shows neutral loading while identity is checking even when static games are nonempty', async () => {
    const { container } = await renderHome('checking')
    expect(container.textContent).toContain('最新游戏：正在确认浏览偏好')
    expect(container.textContent).toContain('最新补丁：正在确认浏览偏好')
    expect(
      container.querySelectorAll('[data-testid="galgame-card"]')
    ).toHaveLength(0)
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
  })
  it('uses both nonempty static public sections for a confirmed guest without a redundant home request', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({ stats: {} })
    const { container } = await renderHome('guest')
    expect(
      container.querySelectorAll('[data-testid="galgame-card"]')
    ).toHaveLength(24)
    expect(container.textContent).toContain('public static resource')
    expect(
      fetchMock.kunFetchGet.mock.calls.filter(([url]) => url === '/home')
    ).toHaveLength(0)
  })
  it('loads both sections together after confirmation and refreshes card stats in one batch', async () => {
    fetchMock.kunFetchGet.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/home'
          ? {
              galgames: [makeGalgame()],
              resources: [{ id: 1, name: 'filtered resource' }]
            }
          : { stats: { abc12345: { view: 15, download: 4 } } }
      )
    )
    const { container } = await renderHome()
    expect(
      fetchMock.kunFetchGet.mock.calls.filter(([url]) => url === '/home')
    ).toHaveLength(1)
    expect(container.textContent).toContain('abc12345:15:4')
    expect(container.textContent).toContain('filtered resource')
    expect(container.textContent).not.toContain('public static resource')
    expect(container.textContent).not.toContain('game0000')
    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/patch/stats', {
      uniqueIds: 'abc12345'
    })
  })
  it('keeps newer card values when incremental stats are older', async () => {
    fetchMock.kunFetchGet.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/home'
          ? { galgames: [makeGalgame()], resources: [] }
          : { stats: { abc12345: { view: 1, download: 1 } } }
      )
    )
    const { container } = await renderHome()
    expect(container.textContent).toContain('abc12345:10:2')
  })
  it('keeps empty personalized results empty without restoring static cards', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({ galgames: [], resources: [] })
    const { container } = await renderHome()
    expect(
      container.querySelectorAll('[data-testid="galgame-card"]')
    ).toHaveLength(0)
    expect(container.textContent).toContain('当前条件下没有最新游戏')
    expect(container.textContent).toContain('当前条件下没有最新补丁')
  })
  it('reports failure without restoring static data', async () => {
    fetchMock.kunFetchGet.mockRejectedValue(new Error('synthetic unavailable'))
    const { container } = await renderHome()
    expect(container.textContent).toContain('首页内容读取失败')
    expect(
      container.querySelectorAll('[data-testid="galgame-card"]')
    ).toHaveLength(0)
  })
  it('drops both old sections after switching account and ignores their delayed response', async () => {
    let completeOld!: (value: unknown) => void
    fetchMock.kunFetchGet.mockImplementation((url: string) =>
      url === '/home'
        ? new Promise((resolve) => {
            completeOld = resolve
          })
        : Promise.resolve({ stats: {} })
    )
    const { container, useUserStore } = await renderHome()
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    fetchMock.kunFetchGet.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/home' ? { galgames: [], resources: [] } : { stats: {} }
      )
    )
    await act(async () => {
      useUserStore.setState({
        user: { ...useUserStore.getState().user, uid: 8 },
        sessionStatus: 'authenticated',
        sessionContext: 'new-context',
        sessionGeneration: 1
      })
      usePreferenceStore.setState({
        generation: 1,
        status: 'ready',
        applied: {
          uid: 8,
          context: 'new-context',
          version: 4,
          nsfwSelected: true,
          blockedTagIds: [19],
          items: { nsfw: { value: 'all', version: 2 } }
        }
      })
    })
    await act(async () => {
      completeOld({
        galgames: [makeGalgame()],
        resources: [{ id: 1, name: 'old account resource' }]
      })
    })
    expect(container.textContent).not.toContain('abc12345')
    expect(container.textContent).not.toContain('old account resource')
    expect(container.textContent).toContain('当前条件下没有最新游戏')
  })
  it('settles filtered results under StrictMode effect cleanup', async () => {
    fetchMock.kunFetchGet.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/home'
          ? { galgames: [makeGalgame()], resources: [] }
          : { stats: {} }
      )
    )
    const { container } = await renderHome('authenticated', true)
    expect(container.textContent).toContain('abc12345:10:2')
  })
})
