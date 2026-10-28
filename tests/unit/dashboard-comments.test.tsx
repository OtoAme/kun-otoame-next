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

import { useComments } from '~/hooks/dashboard/useComments'

let state: ReturnType<typeof useComments>
function Probe() {
  state = useComments()
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

describe('useComments', () => {
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
    expect(state.comments.map((row) => row.id)).toEqual([1, 2])
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

  it('shows a server message as the error and keeps no stale rows', async () => {
    mocks.get.mockResolvedValue('本页面仅管理员可访问')
    await mount('')
    expect(state.error).toBe('本页面仅管理员可访问')
    expect(state.comments).toEqual([])
    expect(state.loading).toBe(false)
  })
})
