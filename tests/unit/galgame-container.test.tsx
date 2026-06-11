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
    options: { cookie?: string; strictMode?: boolean } = {}
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
  })

  it('uses the SFW server list without refetching until filters change', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(2, '客户端列表')],
      total: 1
    })

    const container = await renderContainer({
      initialGalgames: [makeGalgame(1, '服务端全年龄列表')],
      initialTotal: 1,
      initialVisibility: 'pending'
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
        initialVisibility: 'pending'
      },
      {
        cookie: 'kun-patch-setting-store|state|data|kunNsfwEnable=nsfw'
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
        initialVisibility: 'pending'
      },
      { strictMode: true }
    )

    await act(async () => {})

    expect(container.textContent).toContain('服务端全年龄列表')
    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
  })

  it('hides the SFW server list for all-mode cookie values', async () => {
    fetchMock.kunFetchGet.mockResolvedValue({
      galgames: [makeGalgame(2, '客户端混合列表')],
      total: 1
    })

    const container = await renderContainer(
      {
        initialGalgames: [makeGalgame(1, '服务端全年龄列表')],
        initialTotal: 1,
        initialVisibility: 'pending'
      },
      {
        cookie: 'kun-patch-setting-store|state|data|kunNsfwEnable=all'
      }
    )

    expect(container.textContent).not.toContain('服务端全年龄列表')
    expect(fetchMock.kunFetchGet).toHaveBeenCalled()

    await act(async () => {})

    expect(container.textContent).toContain('客户端混合列表')
  })
})
