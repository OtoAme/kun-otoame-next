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

// The query provider subscribes to these stores through plain selector calls;
// fixed values keep the public query scope deterministic.
vi.mock('~/store/userStore', () => {
  const store = { user: { uid: 0, role: 1 } }
  const useUserStore = (selector: (state: typeof store) => unknown) =>
    selector(store)
  useUserStore.getState = () => store
  return { useUserStore }
})

vi.mock('~/store/settingStore', () => {
  const store = { data: { kunNsfwEnable: 'sfw', kunBlockedTagIds: [] } }
  const useSettingStore = (selector: (state: typeof store) => unknown) =>
    selector(store)
  useSettingStore.getState = () => store
  return { useSettingStore }
})

import { useShoutboxFeed } from '~/hooks/useShoutboxFeed'
import { ShoutboxQueryProvider } from '~/components/shoutbox/query/ShoutboxQueryProvider'
import { SHOUTBOX_PAGE_SIZE } from '~/constants/shoutbox'
import type { ShoutboxItem, ShoutboxListResponse } from '~/types/api/shoutbox'

const FETCH_OPTIONS = { timeout: 10_000 }

const makeItem = (
  id: number,
  overrides: Partial<ShoutboxItem> = {}
): ShoutboxItem => ({
  id,
  user: { id: 100 + id, name: `用户${id}`, avatar: '' },
  reportable: true,
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
  const { data, error } = useShoutboxFeed({ home: true })
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

const PatchProbe = ({ patch }: { patch: string }) => {
  useShoutboxFeed({ patch })
  return null
}

const PatchDataProbe = ({ patch }: { patch: string }) => {
  const { data } = useShoutboxFeed({ patch })
  return (
    <output>
      {JSON.stringify({
        rowIds: data?.shoutboxes.map((row) => row.id) ?? []
      })}
    </output>
  )
}

// The shared contract adds `visibilityUntil`: the server-known next real
// official boundary, never TTL-truncated. Tri-state — a string cleans up at
// that instant, null means no known boundary, an absent field (old payload)
// falls back to validUntil.
type FeedPayload = ShoutboxListResponse & { visibilityUntil?: string | null }

const readProbe = (container: HTMLElement) =>
  JSON.parse(container.querySelector('output')!.textContent ?? '{}') as {
    pinnedId: number | null
    rowIds: number[]
    error: string
  }

// TanStack notifies observers through setTimeout(0); under fake timers each
// async step ends with this flush so cache updates reach the probe.
const flushNotify = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1)
  })
}

describe('useShoutboxFeed', () => {
  let dom: JSDOM | undefined
  let root: Root | undefined
  let container: HTMLElement

  const renderProbe = async (element: React.ReactElement = <Probe />) => {
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
      root!.render(<ShoutboxQueryProvider>{element}</ShoutboxQueryProvider>)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
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
    // Home mode fetches the dedicated view=home payload, not a paged list.
    expect(mocks.kunFetchGet).toHaveBeenCalledWith(
      '/shoutbox',
      { view: 'home' },
      FETCH_OPTIONS
    )

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
      await vi.advanceTimersByTimeAsync(1)
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

  it('patch mode reads the regular paged list at the page size', async () => {
    mocks.kunFetchGet.mockResolvedValueOnce({
      pinned: null,
      shoutboxes: [makeItem(5)],
      page: 1,
      totalPages: 1,
      validUntil: new Date(Date.now() + 300_000).toISOString()
    } satisfies ShoutboxListResponse)

    await renderProbe(<PatchProbe patch="abcd1234" />)
    expect(mocks.kunFetchGet).toHaveBeenCalledWith(
      '/shoutbox',
      { page: 1, limit: SHOUTBOX_PAGE_SIZE, patch: 'abcd1234' },
      FETCH_OPTIONS
    )
  })

  it('keeps the pinned slot and rows through a slow TTL refresh when the real visibility boundary is later', async () => {
    const first: FeedPayload = {
      pinned: makeItem(900, {
        official: true,
        level: 'important',
        cost: 0,
        effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
        effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
      }),
      shoutboxes: [makeItem(5), makeItem(4)],
      page: 1,
      totalPages: 1,
      validUntil: new Date(Date.now() + 30_000).toISOString(),
      // The real official boundary is later than the cache TTL.
      visibilityUntil: new Date(Date.now() + 90_000).toISOString()
    }
    mocks.kunFetchGet.mockResolvedValueOnce(first)
    let resolveRefresh!: (value: unknown) => void
    const refresh = new Promise((resolve) => {
      resolveRefresh = resolve
    })
    mocks.kunFetchGet.mockImplementationOnce(() => refresh)

    await renderProbe()
    expect(readProbe(container).pinnedId).toBe(900)

    // The TTL expires while the background refresh is still in flight:
    // nothing is dropped — the current content stays until the new response
    // lands.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(readProbe(container).pinnedId).toBe(900)
    expect(readProbe(container).rowIds).toEqual([5, 4])

    // The successful response atomically replaces the old payload.
    await act(async () => {
      resolveRefresh({
        pinned: makeItem(901, {
          official: true,
          cost: 0,
          effectiveFrom: new Date(Date.now() - 1000).toISOString(),
          effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
        }),
        shoutboxes: [makeItem(5), makeItem(4)],
        page: 1,
        totalPages: 1,
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        visibilityUntil: new Date(Date.now() + 60_000).toISOString()
      } satisfies FeedPayload)
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(readProbe(container).pinnedId).toBe(901)
    expect(readProbe(container).rowIds).toEqual([5, 4])
  })

  it('drops the pinned slot at the real visibility boundary on time even while the freshness refresh is slow and then fails', async () => {
    const first: FeedPayload = {
      pinned: makeItem(900, {
        official: true,
        level: 'important',
        cost: 0,
        effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
        effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
      }),
      shoutboxes: [makeItem(5), makeItem(4)],
      page: 1,
      totalPages: 1,
      validUntil: new Date(Date.now() + 30_000).toISOString(),
      visibilityUntil: new Date(Date.now() + 90_000).toISOString()
    }
    mocks.kunFetchGet.mockResolvedValueOnce(first)
    let rejectRefresh!: (reason?: unknown) => void
    const refresh = new Promise((_, reject) => {
      rejectRefresh = reject
    })
    mocks.kunFetchGet.mockImplementationOnce(() => refresh)

    await renderProbe()
    expect(readProbe(container).pinnedId).toBe(900)

    // TTL expiry: background refresh starts, content stays.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(readProbe(container).pinnedId).toBe(900)

    // The real boundary arrives while the refresh is still in flight: the
    // pinned slot is dropped on time, and no duplicate request is queued
    // behind the slow one.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(readProbe(container).pinnedId).toBeNull()
    expect(readProbe(container).rowIds).toEqual([5, 4])
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    // The refresh then fails: the dropped pinned slot stays gone and the
    // existing 60s backoff still applies.
    await act(async () => {
      rejectRefresh(new Error('network down'))
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(readProbe(container).pinnedId).toBeNull()
    expect(readProbe(container).error).toBe('网络错误，请稍后重试')

    mocks.kunFetchGet.mockResolvedValueOnce({
      pinned: makeItem(901, {
        official: true,
        cost: 0,
        effectiveFrom: new Date(Date.now() - 1000).toISOString(),
        effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
      }),
      shoutboxes: [makeItem(5), makeItem(4)],
      page: 1,
      totalPages: 1,
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      visibilityUntil: null
    } satisfies FeedPayload)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)
    expect(readProbe(container).pinnedId).toBe(901)
  })

  it('never time-drops the pinned slot when the server reports no known boundary (visibilityUntil: null)', async () => {
    // Responses are computed per call so their validUntil is always fresh.
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve({
        pinned: makeItem(900, {
          official: true,
          level: 'important',
          cost: 0,
          effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
          effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
        }),
        shoutboxes: [makeItem(5)],
        page: 1,
        totalPages: 1,
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        visibilityUntil: null
      } satisfies FeedPayload)
    )

    await renderProbe()
    expect(readProbe(container).pinnedId).toBe(900)

    // Each TTL expiry only refreshes in the background; the pinned slot and
    // the rows stay on screen the whole time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(readProbe(container).pinnedId).toBe(900)
    expect(readProbe(container).rowIds).toEqual([5])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)
    expect(readProbe(container).pinnedId).toBe(900)
  })

  it('revalidates against the current time on visibility restore: a past TTL refreshes without dropping, a passed real boundary drops first', async () => {
    const first: FeedPayload = {
      pinned: makeItem(900, {
        official: true,
        level: 'important',
        cost: 0,
        effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
        effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
      }),
      shoutboxes: [makeItem(5)],
      page: 1,
      totalPages: 1,
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      visibilityUntil: new Date(Date.now() + 300_000).toISOString()
    }
    mocks.kunFetchGet.mockResolvedValueOnce(first)
    await renderProbe()
    expect(readProbe(container).pinnedId).toBe(900)

    // The tab was suspended past the TTL but before the real boundary (the
    // pending timers never fired): the restore refreshes in the background
    // and keeps the pinned slot on screen.
    vi.setSystemTime(Date.now() + 120_000)
    let resolveRefresh!: (value: unknown) => void
    const refresh = new Promise((resolve) => {
      resolveRefresh = resolve
    })
    mocks.kunFetchGet.mockImplementationOnce(() => refresh)
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(readProbe(container).pinnedId).toBe(900)

    await act(async () => {
      resolveRefresh({
        pinned: makeItem(900, {
          official: true,
          level: 'important',
          cost: 0,
          effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
          effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
        }),
        shoutboxes: [makeItem(5)],
        page: 1,
        totalPages: 1,
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        visibilityUntil: new Date(Date.now() + 180_000).toISOString()
      } satisfies FeedPayload)
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(readProbe(container).pinnedId).toBe(900)

    // Now the tab comes back past the real boundary: the pinned slot is
    // dropped BEFORE the refetch resolves.
    vi.setSystemTime(Date.now() + 300_000)
    let resolveSecond!: (value: unknown) => void
    const second = new Promise((resolve) => {
      resolveSecond = resolve
    })
    mocks.kunFetchGet.mockImplementationOnce(() => second)
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)
    expect(readProbe(container).pinnedId).toBeNull()
    expect(readProbe(container).rowIds).toEqual([5])

    await act(async () => {
      resolveSecond({
        pinned: null,
        shoutboxes: [makeItem(5)],
        page: 1,
        totalPages: 1,
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        visibilityUntil: null
      } satisfies FeedPayload)
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(readProbe(container).pinnedId).toBeNull()
    expect(readProbe(container).rowIds).toEqual([5])
  })

  it('keys each patch scope separately: a stale in-flight response can never surface under a switched patch', async () => {
    let resolveFirst!: (value: unknown) => void
    mocks.kunFetchGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )
    let resolveSecond!: (value: unknown) => void
    mocks.kunFetchGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve
        })
    )

    await renderProbe(<PatchDataProbe patch="aaaa1111" />)
    expect(mocks.kunFetchGet).toHaveBeenCalledWith(
      '/shoutbox',
      { page: 1, limit: SHOUTBOX_PAGE_SIZE, patch: 'aaaa1111' },
      FETCH_OPTIONS
    )

    // Visibility restores while the first request is still in flight merge
    // into it instead of queueing duplicates.
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // Switching the patch switches the query key: the new scope fetches at
    // once; the interrupted response writes only the old key.
    await act(async () => {
      root!.render(
        <ShoutboxQueryProvider>
          <PatchDataProbe patch="bbbb2222" />
        </ShoutboxQueryProvider>
      )
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledWith(
      '/shoutbox',
      { page: 1, limit: SHOUTBOX_PAGE_SIZE, patch: 'bbbb2222' },
      FETCH_OPTIONS
    )
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveFirst({
        pinned: null,
        shoutboxes: [makeItem(5)],
        page: 1,
        totalPages: 1,
        validUntil: new Date(Date.now() + 300_000).toISOString()
      } satisfies ShoutboxListResponse)
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(readProbe(container).rowIds).toEqual([])

    await act(async () => {
      resolveSecond({
        pinned: null,
        shoutboxes: [makeItem(8)],
        page: 1,
        totalPages: 1,
        validUntil: new Date(Date.now() + 300_000).toISOString()
      } satisfies ShoutboxListResponse)
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(readProbe(container).rowIds).toEqual([8])
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
  })

  it.each([null, 'future'] as const)(
    'backs off an already-expired arrival and still honors its real boundary (%s)',
    async (boundary) => {
      const visibilityUntil =
        boundary === null ? null : new Date(Date.now() + 1000).toISOString()
      mocks.kunFetchGet
        .mockResolvedValueOnce({
          pinned: makeItem(900, { official: true }),
          shoutboxes: [makeItem(5)],
          page: 1,
          totalPages: 1,
          validUntil: new Date(Date.now() - 1).toISOString(),
          visibilityUntil
        })
        .mockResolvedValue({
          pinned: null,
          shoutboxes: [makeItem(5)],
          page: 1,
          totalPages: 1,
          validUntil: new Date(Date.now() + 60_000).toISOString(),
          visibilityUntil: null
        } satisfies FeedPayload)
      await renderProbe()
      expect(readProbe(container).pinnedId).toBe(900)

      // The boundary (if any) hides the pinned slot on time, but the
      // already-expired-on-arrival payload may not refetch until the 60s
      // backoff ends — no hot-loop, no instant refetch at the boundary.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(readProbe(container).pinnedId).toBe(boundary === null ? 900 : null)
      expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    }
  )
})
