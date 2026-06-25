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

describe('HomeContainer', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderHome = async (galgames = [makeGalgame()]) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { HomeContainer } = await import('~/components/home/Container')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<HomeContainer galgames={galgames} resources={[]} />)
    })

    return container!
  }

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
    fetchMock.kunFetchGet.mockReset()
  })

  it('refreshes realtime card stats after mounting the static home payload', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      stats: {
        abc12345: {
          view: 15,
          download: 4
        }
      }
    })

    const container = await renderHome()

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/patch/stats', {
      uniqueIds: 'abc12345'
    })
    expect(container.textContent).toContain('abc12345:15:4')
  })

  it('keeps static values when realtime stats are older', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      stats: {
        abc12345: {
          view: 1,
          download: 1
        }
      }
    })

    const container = await renderHome()

    expect(container.textContent).toContain('abc12345:10:2')
  })

  it('fetches the home payload only when the static game section is empty', async () => {
    fetchMock.kunFetchGet.mockImplementation((url: string) => {
      if (url === '/home') {
        return Promise.resolve({
          galgames: [makeGalgame()],
          resources: []
        })
      }

      return Promise.resolve({ stats: {} })
    })

    const container = await renderHome([])

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/home')
    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/patch/stats', {
      uniqueIds: 'abc12345'
    })
    expect(container.textContent).toContain('abc12345:10:2')
  })

  it('does not refetch the home payload when static games are present', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({ stats: {} })

    await renderHome()

    expect(fetchMock.kunFetchGet).not.toHaveBeenCalledWith('/home')
  })

  it('does not lose the empty-home fallback result under StrictMode remount', async () => {
    let resolveHome:
      | ((value: { galgames: GalgameCard[]; resources: [] }) => void)
      | undefined

    fetchMock.kunFetchGet.mockImplementation((url: string) => {
      if (url === '/home') {
        return new Promise((resolve) => {
          resolveHome = resolve
        })
      }

      return Promise.resolve({ stats: {} })
    })

    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { HomeContainer } = await import('~/components/home/Container')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <React.StrictMode>
          <HomeContainer galgames={[]} resources={[]} />
        </React.StrictMode>
      )
    })

    await act(async () => {
      resolveHome?.({ galgames: [makeGalgame()], resources: [] })
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/home')
    expect(
      fetchMock.kunFetchGet.mock.calls.filter(([url]) => url === '/home')
    ).toHaveLength(1)
    expect(container!.textContent).toContain('abc12345:10:2')
  })
})
