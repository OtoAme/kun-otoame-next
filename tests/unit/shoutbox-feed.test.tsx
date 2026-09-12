import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet
}))

import { useShoutboxFeed } from '~/hooks/useShoutboxFeed'
import type { ShoutboxItem, ShoutboxListResponse } from '~/types/api/shoutbox'

const makeItem = (
  id: number,
  overrides: Partial<ShoutboxItem> = {}
): ShoutboxItem => ({
  id,
  user: { id: 100 + id, name: `用户${id}`, avatar: '' },
  content: `消息 ${id}`,
  link: '',
  official: false,
  level: 'normal',
  status: 0,
  cost: 50,
  patch: null,
  effectiveFrom: null,
  effectiveTo: null,
  editedAt: null,
  hiddenAt: null,
  refundedAt: null,
  created: new Date(Date.now() - id * 1000).toISOString(),
  updated: new Date(Date.now() - id * 1000).toISOString(),
  ...overrides
})

const Probe = () => {
  const { data, error } = useShoutboxFeed({})
  return (
    <output>
      {JSON.stringify({
        pinnedId: data?.pinned?.id ?? null,
        rowIds: data?.shoutboxes.map((row) => row.id) ?? [],
        error
      })}
    </output>
  )
}

const readProbe = (container: HTMLElement) =>
  JSON.parse(container.querySelector('output')!.textContent ?? '{}') as {
    pinnedId: number | null
    rowIds: number[]
    error: string
  }

describe('useShoutboxFeed', () => {
  let dom: JSDOM | undefined
  let root: Root | undefined
  let container: HTMLElement

  const renderProbe = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(dom.window.document, 'visibilityState', {
      value: 'visible',
      configurable: true
    })

    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<Probe />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.kunFetchGet.mockReset()
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('drops the pinned slot at a next-message boundary while A is still in its own interval, keeps it gone on failure, and retries with backoff', async () => {
    const pinnedA = makeItem(900, {
      official: true,
      level: 'important',
      cost: 0,
      // A is still inside its own effective interval…
      effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
      effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
    })
    const first: ShoutboxListResponse = {
      pinned: pinnedA,
      shoutboxes: [makeItem(5), makeItem(4)],
      page: 1,
      totalPages: 1,
      // …but validUntil marks the NEXT official message B starting earlier.
      validUntil: new Date(Date.now() + 30_000).toISOString()
    }
    mocks.kunFetchGet.mockResolvedValueOnce(first)
    let rejectRefetch!: (reason?: unknown) => void
    const refetch = new Promise((_, reject) => {
      rejectRefetch = reject
    })
    mocks.kunFetchGet.mockImplementationOnce(() => refetch)

    await renderProbe()
    expect(readProbe(container).pinnedId).toBe(900)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    // The boundary dropped the pinned slot before the refetch resolved; the
    // ordinary rows stay.
    expect(readProbe(container).pinnedId).toBeNull()
    expect(readProbe(container).rowIds).toEqual([5, 4])
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    await act(async () => {
      rejectRefetch(new Error('network down'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(readProbe(container).pinnedId).toBeNull()
    expect(readProbe(container).rowIds).toEqual([5, 4])
    expect(readProbe(container).error).toBe('网络错误，请稍后重试')

    // The existing backoff still retries after the base cache duration.
    mocks.kunFetchGet.mockImplementationOnce(() =>
      Promise.resolve({
        pinned: makeItem(901, {
          official: true,
          cost: 0,
          effectiveFrom: new Date(Date.now() - 1000).toISOString(),
          effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
        }),
        shoutboxes: [makeItem(5), makeItem(4)],
        page: 1,
        totalPages: 1,
        validUntil: new Date(Date.now() + 60_000).toISOString()
      } satisfies ShoutboxListResponse)
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)
    expect(readProbe(container).pinnedId).toBe(901)
  })
})
