// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams()
}))
vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.get }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/resource-merges',
  useSearchParams: () => mocks.params,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace })
}))

import { useSearchableList } from '~/hooks/dashboard/useSearchableList'

let state: ReturnType<typeof useSearchableList<{ id: number }>>
function Probe() {
  state = useSearchableList<{ id: number }>({
    endpoint: '/admin/resource-merges',
    field: 'items',
    fallbackError: '获取失败'
  })
  return null
}

describe('useSearchableList response and selection additions', () => {
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(document.createElement('div'))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  const mount = async (query: string) => {
    mocks.params = new URLSearchParams(query)
    await act(async () => root.render(<Probe />))
  }

  it('exposes the whole response of the current query', async () => {
    mocks.get.mockResolvedValue({
      items: [{ id: 1 }],
      total: 1,
      counts: { pending: 1, dismissed: 2, merged: 3 }
    })
    await mount('')
    expect(state.rows).toEqual([{ id: 1 }])
    expect(state.response?.counts).toEqual({
      pending: 1,
      dismissed: 2,
      merged: 3
    })
  })

  it('has no response while the query failed', async () => {
    mocks.get.mockResolvedValue('无权访问')
    await mount('')
    expect(state.error).toBe('无权访问')
    expect(state.response).toBeNull()
  })

  it('pushes a selection by default and replaces it on request', async () => {
    mocks.get.mockResolvedValue({ items: [{ id: 1 }, { id: 2 }], total: 2 })
    await mount('id=1')
    act(() => state.select(2))
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/dashboard/resource-merges?page=1&limit=30&searchType=content&id=2',
      { scroll: false }
    )
    expect(mocks.replace).not.toHaveBeenCalled()
    act(() => state.select(2, 'replace'))
    expect(mocks.replace).toHaveBeenLastCalledWith(
      '/dashboard/resource-merges?page=1&limit=30&searchType=content&id=2',
      { scroll: false }
    )
    act(() => state.select(1, 'replace'))
    expect(mocks.replace).toHaveBeenCalledTimes(1)
  })
})
