import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams()
}))
vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.get }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/comment',
  useSearchParams: () => mocks.params,
  useRouter: () => ({ push: mocks.push })
}))

import { useSearchableList } from '~/hooks/dashboard/useSearchableList'

type Row = { id: number }
let state: ReturnType<typeof useSearchableList<Row>>
function Probe() {
  state = useSearchableList<Row>({
    endpoint: '/admin/comment',
    field: 'comments',
    fallbackError: '获取评论列表失败'
  })
  return null
}

const comment = (id: number) => ({
  id,
  uniqueId: 'aaaa1111',
  user: { id: 5, name: 'momo', avatar: '' },
  content: `评论 ${id}`,
  patchName: '夏空カナタ',
  patchId: 1,
  like: 0,
  created: '2026-10-28T00:00:00.000Z'
})

describe('useSearchableList', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    dom = new JSDOM('<!doctype html><div id="root"></div>')
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
    mocks.get.mockResolvedValue({
      comments: [comment(1), comment(2)],
      total: 2
    })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const mount = async (query: string) => {
    mocks.params = new URLSearchParams(query)
    await act(async () => root.render(<Probe />))
  }

  it('reads a user search from the URL and ignores out-of-range values', async () => {
    await mount(
      'page=0&limit=9999&searchType=user&userId=5&userName=momo&id=2&search=x'
    )
    expect(state.query).toMatchObject({
      page: 1,
      limit: 30,
      searchType: 'user',
      search: '',
      userId: 5,
      userName: 'momo',
      selected: 2
    })
    expect(mocks.get).toHaveBeenCalledWith('/admin/comment', {
      page: 1,
      limit: 30,
      searchType: 'user',
      userId: 5
    })
    expect(state.rows.map((row) => row.id)).toEqual([1, 2])
  })

  it('does not refetch the list when only the selection changes', async () => {
    await mount('id=1')
    expect(mocks.get).toHaveBeenCalledTimes(1)
    await act(async () => {
      mocks.params = new URLSearchParams('id=2')
      root.render(<Probe />)
    })
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(state.query.selected).toBe(2)
  })

  it('drops the selection whenever the list changes', async () => {
    await mount('page=1&limit=30&searchType=content&id=2')
    act(() => state.commitSearch('  补丁  '))
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/dashboard/comment?page=1&limit=30&searchType=content&search=%E8%A1%A5%E4%B8%81',
      { scroll: false }
    )
    act(() => state.setSearchType('user'))
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/dashboard/comment?page=1&limit=30&searchType=user',
      { scroll: false }
    )
  })

  it('steps back a page when a delete empties the current one', async () => {
    mocks.get.mockResolvedValue({ comments: [comment(61)], total: 61 })
    await mount('page=3&limit=30')
    act(() => state.notifyDeleted(1))
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/dashboard/comment?page=2&limit=30&searchType=content',
      { scroll: false }
    )
  })

  it('reads rows from the configured response field', async () => {
    mocks.get.mockResolvedValue({ ratings: [comment(3)], total: 1 })
    await mount('')
    expect(state.rows).toEqual([])
    expect(state.error).toBe('获取评论列表失败')
  })

  it('shows a server message as the error and keeps no stale rows', async () => {
    mocks.get.mockResolvedValue('本页面仅管理员可访问')
    await mount('')
    expect(state.error).toBe('本页面仅管理员可访问')
    expect(state.rows).toEqual([])
    expect(state.loading).toBe(false)
  })
})

describe('useSearchableList page filters', () => {
  let dom: JSDOM
  let root: Root
  let filtered: ReturnType<typeof useSearchableList<{ id: number }>>

  function FilteredProbe() {
    filtered = useSearchableList<{ id: number }>({
      endpoint: '/admin/resource',
      field: 'resources',
      fallbackError: '获取资源列表失败',
      filters: {
        section: (raw) => (raw === 'galgame' || raw === 'patch' ? raw : null),
        status: (raw) =>
          ['0', '1', '2'].filter((v) => raw.split(',').includes(v)).join(',') ||
          null,
        rating: (raw) => (raw === 'sfw' || raw === 'nsfw' ? raw : null)
      },
      defaultParams: { rating: 'all' }
    })
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    dom = new JSDOM('<!doctype html><div id="root"></div>')
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
    mocks.get.mockResolvedValue({ resources: [], total: 0 })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const mount = async (query: string) => {
    mocks.params = new URLSearchParams(query)
    await act(async () => root.render(<FilteredProbe />))
  }

  it('sends valid filters, drops invalid ones and keeps the default rating', async () => {
    await mount('section=patch&status=2,9,1&rating=r18&unknown=1')
    expect(filtered.query.filters).toEqual({ section: 'patch', status: '1,2' })
    expect(mocks.get).toHaveBeenCalledWith('/admin/resource', {
      page: 1,
      limit: 30,
      searchType: 'content',
      rating: 'all',
      section: 'patch',
      status: '1,2'
    })
  })

  it('lets a chosen filter replace its default parameter', async () => {
    await mount('rating=nsfw')
    expect(mocks.get).toHaveBeenCalledWith(
      '/admin/resource',
      expect.objectContaining({ rating: 'nsfw' })
    )
  })

  it('refetches when a filter changes and returns to page 1', async () => {
    await mount('page=3&section=patch&id=5')
    act(() => filtered.setFilters({ section: 'galgame', status: '0' }))
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/dashboard/comment?page=1&limit=30&searchType=content&section=galgame&status=0',
      { scroll: false }
    )
    act(() => filtered.setFilters({ section: '' }))
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/dashboard/comment?page=1&limit=30&searchType=content',
      { scroll: false }
    )
  })

  it('treats a filter change as a new list request', async () => {
    await mount('section=patch')
    const first = filtered.query.key
    await act(async () => {
      mocks.params = new URLSearchParams('section=galgame')
      root.render(<FilteredProbe />)
    })
    expect(filtered.query.key).not.toBe(first)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })
})
