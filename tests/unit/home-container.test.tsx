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
    onPress,
    isDisabled,
    ...props
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    as?: unknown
    color?: unknown
    endContent?: React.ReactNode
    variant?: unknown
    [key: string]: unknown
  }) => (
    <button {...props} onClick={onPress} disabled={isDisabled}>
      {children}
    </button>
  )
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

describe('HomeContainer public SFW results', () => {
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
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    useUserStore.setState({
      sessionStatus: status,
      user: { ...useUserStore.getState().user, uid: 7 },
      sessionContext: 'first-context',
      sessionGeneration: 0
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
    await act(async () =>
      root!.render(
        strict ? <React.StrictMode>{element}</React.StrictMode> : element
      )
    )
    return { container, useUserStore, usePreferenceStore }
  }
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    dom?.window.close()
    vi.unstubAllGlobals()
    vi.resetModules()
    fetchMock.kunFetchGet.mockReset()
  })
  it.each(['checking', 'guest', 'authenticated'] as const)(
    'renders both SFW sections while session is %s without reading home preferences',
    async (status) => {
      fetchMock.kunFetchGet.mockResolvedValue({ stats: {} })
      const { container } = await renderHome(status)
      expect(container.textContent).not.toContain('正在确认浏览偏好')
      expect(container.textContent).toContain('public static resource')
      expect(
        container.querySelectorAll('[data-testid="galgame-card"]')
      ).toHaveLength(24)
      expect(
        fetchMock.kunFetchGet.mock.calls.filter(([url]) => url === '/home')
      ).toHaveLength(0)
    }
  )
  it('preserves the same cards across session failures, account switches and all preference changes', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({ stats: {} })
    const { container, useUserStore, usePreferenceStore } = await renderHome()
    const card = container.querySelector('[data-testid="galgame-card"]')
    for (const status of [
      'checking',
      'unavailable',
      'authenticated',
      'guest'
    ] as const) {
      await act(async () => useUserStore.getState().setSessionStatus(status))
      expect(container.querySelector('[data-testid="galgame-card"]')).toBe(card)
    }
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
          version: 2,
          nsfwSelected: true,
          blockedTagIds: [19],
          items: { nsfw: { value: 'all', version: 2 } }
        }
      })
    })
    expect(container.querySelector('[data-testid="galgame-card"]')).toBe(card)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(fetchMock.kunFetchGet.mock.calls[0][0]).toBe('/patch/stats')
  })
  it.each([false, true])(
    'refreshes counters once and keeps the cards under StrictMode=%s',
    async (strict) => {
      fetchMock.kunFetchGet.mockResolvedValue({
        stats: { game0000: { view: 15, download: 4 } }
      })
      const { container } = await renderHome('authenticated', strict)
      expect(container.textContent).toContain('game0000:15:4')
      expect(container.textContent).toContain('public static resource')
      expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    }
  )
  it('keeps newer counters when the incremental snapshot is older', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      stats: { game0000: { view: 1, download: 1 } }
    })
    const { container } = await renderHome()
    expect(container.textContent).toContain('game0000:10:2')
  })
})
