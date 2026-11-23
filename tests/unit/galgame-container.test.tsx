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

vi.mock('~/components/galgame/Card', () => ({
  GalgameCard: ({ patch }: { patch: GalgameCard }) => (
    <article data-testid="galgame-card">{patch.name}</article>
  )
}))

vi.mock('~/components/galgame/FilterBar', () => ({
  FilterBar: ({ setSortField }: { setSortField: (value: string) => void }) => (
    <button type="button" onClick={() => setSortField('created')}>
      切换排序
    </button>
  )
}))

vi.mock('~/components/kun/Loading', () => ({
  KunLoading: ({ hint }: { hint: string }) => (
    <div data-testid="galgame-loading">{hint}</div>
  )
}))

vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: ({
    onPageChange
  }: {
    onPageChange: (page: number) => void
  }) => (
    <button type="button" onClick={() => onPageChange(2)}>
      下一页
    </button>
  )
}))

vi.mock('~/components/kun/Header', () => ({
  KunHeader: ({ name }: { name: string }) => <h1>{name}</h1>
}))

const makeGalgame = (id: number, name: string): GalgameCard => ({
  id,
  uniqueId: `test${id.toString().padStart(4, '0')}`,
  name,
  banner: `/banner-${id}.webp`,
  view: 0,
  download: 0,
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

describe('Galgame CardContainer', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderContainer = async (
    props: React.ComponentProps<
      (typeof import('~/components/galgame/Container'))['CardContainer']
    >,
    options: {
      cookie?: string
      mode?: 'sfw' | 'nsfw' | 'all'
      blockedTagIds?: number[]
      strictMode?: boolean
    } = {}
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    if (options.cookie) {
      dom.window.document.cookie = options.cookie
    }

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { useUserStore } = await import('~/store/userStore')
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    const authenticated = !!options.mode || !!options.blockedTagIds
    useUserStore.setState({
      user: { ...useUserStore.getState().user, uid: authenticated ? 7 : 0 },
      sessionStatus: authenticated ? 'authenticated' : 'guest',
      sessionContext: authenticated ? 'confirmed-context' : null,
      sessionGeneration: 0
    })
    usePreferenceStore.setState({
      generation: 0,
      status: 'ready',
      applied: authenticated
        ? {
            uid: 7,
            context: 'confirmed-context',
            version: 0,
            nsfwSelected: true,
            blockedTagIds: options.blockedTagIds ?? [],
            items: { nsfw: { value: options.mode ?? 'sfw', version: 0 } }
          }
        : null
    })

    const { CardContainer } = await import('~/components/galgame/Container')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(
        options.strictMode ? (
          <React.StrictMode>
            <CardContainer {...props} />
          </React.StrictMode>
        ) : (
          <CardContainer {...props} />
        )
      )
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
    fetchMock.kunFetchGet.mockReset()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('reuses the matching server list for an all-mode account through session rechecks', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({ galgames: [], total: 0 })
    const container = await renderContainer(
      {
        initialGalgames: [makeGalgame(1, '服务器账号列表')],
        initialTotal: 1,
        initialScope: {
          identity: 'confirmed-context',
          browsingKey: '["all",[]]'
        }
      },
      { mode: 'all', strictMode: true }
    )
    const card = container.querySelector('[data-testid="galgame-card"]')
    const { useUserStore } = await import('~/store/userStore')
    for (const status of ['checking', 'authenticated'] as const) {
      await act(async () => useUserStore.getState().setSessionStatus(status))
    }
    expect(container.textContent).toContain('服务器账号列表')
    expect(container.querySelector('[data-testid="galgame-card"]')).toBe(card)
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
  })

  it('uses the SFW server list without refetching until filters change', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(2, '客户端列表')],
      total: 1
    })

    const container = await renderContainer({
      initialGalgames: [makeGalgame(1, '服务端全年龄列表')],
      initialTotal: 1,
      initialScope: { identity: 'guest', browsingKey: '["sfw",[]]' }
    })

    await act(async () => {})

    expect(container.textContent).toContain('服务端全年龄列表')
    expect(container.textContent).not.toContain('客户端列表')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()

    const sortButton = dom!.window.document.querySelector('button')
    expect(sortButton).not.toBeNull()

    await act(async () => {
      sortButton!.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/otomegame',
      expect.objectContaining({
        sortField: 'created'
      })
    )
  })

  it('hides the SFW server list before fetching NSFW or all-mode results', async () => {
    let resolveFetch:
      | ((value: { galgames: GalgameCard[]; total: number }) => void)
      | undefined

    fetchMock.kunFetchGet.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      })
    )

    const container = await renderContainer(
      {
        initialGalgames: [makeGalgame(1, '服务端全年龄列表')],
        initialTotal: 1,
        initialScope: { identity: 'guest', browsingKey: '["sfw",[]]' }
      },
      {
        mode: 'nsfw'
      }
    )

    expect(container.textContent).not.toContain('服务端全年龄列表')
    expect(container.textContent).toContain('正在获取 OtomeGame 中')
    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/otomegame',
      expect.objectContaining({
        selectedType: 'all',
        selectedLanguage: 'all',
        selectedPlatform: 'all',
        sortField: 'resource_update_time',
        sortOrder: 'desc',
        page: 1,
        limit: 24
      })
    )

    await act(async () => {
      resolveFetch?.({
        galgames: [makeGalgame(2, '客户端 R18 列表')],
        total: 1
      })
    })

    expect(container.textContent).toContain('客户端 R18 列表')
    expect(container.textContent).not.toContain('服务端全年龄列表')
  })

  it('does not refetch the SFW server list on initial mount under StrictMode', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(2, '客户端列表')],
      total: 1
    })

    const container = await renderContainer(
      {
        initialGalgames: [makeGalgame(1, '服务端全年龄列表')],
        initialTotal: 1,
        initialScope: { identity: 'guest', browsingKey: '["sfw",[]]' }
      },
      { strictMode: true }
    )

    await act(async () => {})

    expect(container.textContent).toContain('服务端全年龄列表')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
  })

  it('hides the SFW server list for server-confirmed all-mode preferences', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(2, '客户端混合列表')],
      total: 1
    })

    const container = await renderContainer(
      {
        initialGalgames: [makeGalgame(1, '服务端全年龄列表')],
        initialTotal: 1,
        initialScope: { identity: 'guest', browsingKey: '["sfw",[]]' }
      },
      {
        mode: 'all'
      }
    )

    expect(container.textContent).not.toContain('服务端全年龄列表')
    expect(fetchMock.kunFetchGet).toHaveBeenCalled()

    await act(async () => {})

    expect(container.textContent).toContain('客户端混合列表')
  })

  it('applies confirmed blocked tags even in SFW mode', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({ galgames: [], total: 0 })
    const container = await renderContainer(
      {
        initialGalgames: [makeGalgame(1, 'blocked static game')],
        initialTotal: 1,
        initialScope: { identity: 'guest', browsingKey: '["sfw",[]]' }
      },
      { mode: 'sfw', blockedTagIds: [7] }
    )
    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('blocked static game')
  })

  it('ignores a residual NSFW cookie for a confirmed guest', async () => {
    const container = await renderContainer(
      {
        initialGalgames: [makeGalgame(1, 'public SFW game')],
        initialTotal: 1,
        initialScope: { identity: 'guest', browsingKey: '["sfw",[]]' }
      },
      { cookie: 'kun-patch-setting-store|state|data|kunNsfwEnable=all' }
    )
    expect(container.textContent).toContain('public SFW game')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
  })

  it('ignores results requested under a previous browsing preference', async () => {
    let complete!: (value: unknown) => void
    fetchMock.kunFetchGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const container = await renderContainer(
      {
        initialGalgames: [],
        initialTotal: 0,
        initialScope: { identity: 'guest', browsingKey: '["sfw",[]]' }
      },
      { mode: 'all' }
    )
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(2, 'current SFW result')],
      total: 1
    })
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    await act(async () => {
      const applied = usePreferenceStore.getState().applied!
      usePreferenceStore.setState({
        applied: {
          ...applied,
          version: 1,
          items: { ...applied.items, nsfw: { value: 'sfw', version: 1 } }
        }
      })
    })
    expect(container.textContent).toContain('current SFW result')
    await act(async () =>
      complete({
        galgames: [makeGalgame(3, 'outdated adult result')],
        total: 1
      })
    )
    expect(container.textContent).toContain('current SFW result')
    expect(container.textContent).not.toContain('outdated adult result')
  })
})
