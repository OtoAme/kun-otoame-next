import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  uid: 0,
  nsfw: 'sfw',
  blockedTagIds: [] as number[]
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet
}))

// Mutable getters let a test switch account/preference mid-run; the provider
// re-reads them on the next render.
vi.mock('~/store/userStore', () => {
  const store = {
    get user() {
      return { uid: mocks.uid, role: 1 }
    }
  }
  const useUserStore = (selector: (state: typeof store) => unknown) =>
    selector(store)
  useUserStore.getState = () => store
  return { useUserStore }
})

vi.mock('~/store/settingStore', () => {
  const store = {
    get data() {
      return {
        kunNsfwEnable: mocks.nsfw,
        kunBlockedTagIds: mocks.blockedTagIds
      }
    }
  }
  const useSettingStore = (selector: (state: typeof store) => unknown) =>
    selector(store)
  useSettingStore.getState = () => store
  return { useSettingStore }
})

import {
  notifyShoutboxPublicWrite,
  SHOUTBOX_GLOBAL_COOLDOWN_MS
} from '~/components/shoutbox/query/core'
import { useShoutboxQuery } from '~/components/shoutbox/query/useShoutboxQuery'
import {
  ShoutboxQueryProvider,
  useShoutboxQueryContext
} from '~/components/shoutbox/query/ShoutboxQueryProvider'
import {
  projectShoutboxBannerDisplay,
  projectShoutboxGlobalListDisplay
} from '~/utils/shoutboxVisibility'
import type { QueryClient } from '@tanstack/react-query'
import type {
  ShoutboxBannerResponse,
  ShoutboxListResponse
} from '~/types/api/shoutbox'
import type { ShoutboxRequestContext } from '~/types/api/shoutbox'

const makeList = (
  overrides: Partial<ShoutboxListResponse> = {}
): ShoutboxListResponse => ({
  pinned: null,
  shoutboxes: [],
  page: 1,
  totalPages: 1,
  validUntil: new Date(Date.now() + 60_000).toISOString(),
  ...overrides
})

const ListProbe = ({ page = 1 }: { page?: number }) => {
  const query = useShoutboxQuery<ShoutboxListResponse>({
    view: 'list',
    page,
    project: projectShoutboxGlobalListDisplay
  })
  return (
    <output>
      {JSON.stringify({
        status: query.status,
        ids: query.displayData?.shoutboxes.map((row) => row.id) ?? null,
        pinned: query.displayData?.pinned?.id ?? null,
        error: query.error?.message ?? ''
      })}
    </output>
  )
}

const DisabledBannerProbe = () => {
  useShoutboxQuery<ShoutboxBannerResponse>({
    view: 'banner',
    active: false,
    project: projectShoutboxBannerDisplay
  })
  return null
}

// Captures the provider context and exposes a write trigger using the
// null-safe accessor semantics of the real mutation components.
let capturedContext: ReturnType<typeof useShoutboxQueryContext> | null = null
const WriteProbe = () => {
  capturedContext = useShoutboxQueryContext()
  return (
    <button
      aria-label="write"
      onClick={() => void notifyShoutboxPublicWrite(capturedContext)}
    />
  )
}

describe('shoutbox public query layer', () => {
  let dom: JSDOM | undefined
  let root: Root | undefined
  let container: HTMLElement

  const flushNotify = async () => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })
  }

  const setVisibility = (value: 'visible' | 'hidden') => {
    Object.defineProperty(dom!.window.document, 'visibilityState', {
      value,
      configurable: true
    })
  }

  const renderTree = async (
    element: React.ReactElement | null,
    visibility: 'visible' | 'hidden' = 'visible'
  ) => {
    if (!dom) {
      dom = new JSDOM('<!doctype html><div id="root"></div>', {
        url: 'http://localhost/shoutbox'
      })
      vi.stubGlobal('window', dom.window)
      vi.stubGlobal('document', dom.window.document)
      vi.stubGlobal('React', React)
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    }
    setVisibility(visibility)
    container = dom.window.document.getElementById('root')!
    if (!root) {
      root = createRoot(container)
    }
    await act(async () => {
      root!.render(<ShoutboxQueryProvider>{element}</ShoutboxQueryProvider>)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
  }

  const readProbe = () =>
    JSON.parse(container.querySelector('output')!.textContent ?? '{}') as {
      status: string
      ids?: number[] | null
      pinned?: number | null
      error?: string
      hasData?: boolean
    }

  const getClient = (): QueryClient => capturedContext!.client

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.kunFetchGet.mockReset()
    mocks.uid = 0
    mocks.nsfw = 'sfw'
    mocks.blockedTagIds = []
    capturedContext = null
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

  it('serves a remount 45s into a 60s payload without a new GET', async () => {
    mocks.kunFetchGet.mockResolvedValue(makeList())
    await renderTree(<ListProbe />)
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // Unmount the consumer (the provider and its client stay) and remount
    // 45s later: the fresh cache answers, no request goes out.
    await renderTree(null)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000)
    })
    await renderTree(<ListProbe />)
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(readProbe().status).toBe('success')

    // Once the absolute deadline passes, a mounted consumer refetches.
    mocks.kunFetchGet.mockResolvedValue(makeList())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight request between two consumers of the same key', async () => {
    mocks.kunFetchGet.mockResolvedValue(makeList())
    await renderTree(
      <>
        <ListProbe />
        <WriteProbe />
      </>
    )
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
  })

  it('never auto-fetches while hidden — first mount included — and merges the restore', async () => {
    mocks.kunFetchGet.mockResolvedValue(makeList())
    await renderTree(<ListProbe />, 'hidden')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(mocks.kunFetchGet).not.toHaveBeenCalled()

    // Visibility restore issues exactly one read.
    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // The TTL passes while hidden again: no request until the restore.
    setVisibility('hidden')
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
  })

  it('honors the error cooldown across a remount', async () => {
    mocks.kunFetchGet.mockResolvedValue('小喇叭暂时不可用，请稍后重试')
    await renderTree(<ListProbe />)
    expect(readProbe().error).toBe('小喇叭暂时不可用，请稍后重试')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // Remounting halfway through the cooldown must not reset or bypass it.
    await renderTree(null)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    await renderTree(<ListProbe />)
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // Computed at request time so the new validity window starts at the
    // actual retry moment, not when the mock was installed.
    mocks.kunFetchGet.mockImplementation(() => Promise.resolve(makeList()))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SHOUTBOX_GLOBAL_COOLDOWN_MS)
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(readProbe().status).toBe('success')
  })

  it('refetches a naturally expired payload at once but backs off one that arrived expired', async () => {
    // Natural deadline: validUntil lies ahead of the receive time.
    mocks.kunFetchGet.mockResolvedValueOnce(
      makeList({ validUntil: new Date(Date.now() + 2_000).toISOString() })
    )
    await renderTree(<ListProbe />)
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    // Arrived already expired: one retry after the cooldown, no hot loop.
    mocks.kunFetchGet.mockResolvedValue(
      makeList({ validUntil: new Date(Date.now() - 1000).toISOString() })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SHOUTBOX_GLOBAL_COOLDOWN_MS)
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)
  })

  it('an account switch cancels and removes the old scope; its payload never renders', async () => {
    mocks.uid = 1
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve(
        makeList({
          shoutboxes: [
            {
              id: 5,
              user: { id: 9, name: '甲', avatar: '' },
              reportable: true,
              content: '旧账号的消息',
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
              created: new Date().toISOString(),
              updated: new Date().toISOString()
            }
          ]
        })
      )
    )
    await renderTree(
      <>
        <ListProbe />
        <WriteProbe />
      </>
    )
    expect(readProbe().ids).toEqual([5])
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    const client = getClient()
    expect(client.getQueryCache().getAll()).toHaveLength(1)

    // Switch account: the old scope's queries are cancelled and removed, the
    // new scope fetches its own payload, and nothing old renders meanwhile.
    mocks.uid = 2
    mocks.kunFetchGet.mockImplementation(() => Promise.resolve(makeList()))
    await act(async () => {
      root!.render(
        <ShoutboxQueryProvider>
          <ListProbe />
          <WriteProbe />
        </ShoutboxQueryProvider>
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
    expect(readProbe().ids).toEqual([])
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.queryKey[4] === 2)
    ).toBe(true)
  })

  it('a write refetches only current-scope observed queries while visible — never disabled, hidden, or consumer-free keys', async () => {
    mocks.kunFetchGet.mockResolvedValue(makeList())
    await renderTree(
      <>
        <ListProbe />
        <DisabledBannerProbe />
        <WriteProbe />
      </>
    )
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // Visible write: the observed list key refetches; the disabled banner
    // consumer (unsubscribed observer) does not.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith(
      '/shoutbox',
      { page: 1, limit: 20 },
      { timeout: 10_000 }
    )

    // Hidden write: the stale mark lands but no request goes out; the
    // visibility restore follows the normal gate and refetches once.
    setVisibility('hidden')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)

    // No consumer mounted: a write never fetches.
    await renderTree(null)
    capturedContext = null
    await act(async () => {
      await notifyShoutboxPublicWrite(null)
      await Promise.resolve()
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)
  })

  it('a stale render-closure context still refreshes the CURRENT scope after an account switch', async () => {
    mocks.uid = 1
    mocks.kunFetchGet.mockResolvedValue(makeList())
    await renderTree(
      <>
        <ListProbe />
        <WriteProbe />
      </>
    )
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    // The context object captured by the ongoing write predates the switch.
    const staleContext = capturedContext

    mocks.uid = 2
    await act(async () => {
      root!.render(
        <ShoutboxQueryProvider>
          <ListProbe />
          <WriteProbe />
        </ShoutboxQueryProvider>
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    await act(async () => {
      await notifyShoutboxPublicWrite(staleContext)
      await Promise.resolve()
    })
    await flushNotify()
    // One refetch, for the new uid's key only.
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)
    expect(
      getClient()
        .getQueryCache()
        .getAll()
        .every((query) => query.queryKey[4] === 2)
    ).toBe(true)
  })

  it('keeps the old payload on a failed background refresh (string error) and reports it without losing data', async () => {
    mocks.kunFetchGet.mockResolvedValueOnce(
      makeList({ validUntil: new Date(Date.now() + 2_000).toISOString() })
    )
    let noticed = ''
    const NoticeProbe = () => {
      const query = useShoutboxQuery<ShoutboxListResponse>({
        view: 'list',
        project: projectShoutboxGlobalListDisplay,
        notifyOnBackgroundError: (message) => {
          noticed = message
        }
      })
      return (
        <output>
          {JSON.stringify({
            status: query.status,
            hasData: query.displayData !== undefined,
            error: query.error?.message ?? ''
          })}
        </output>
      )
    }
    await renderTree(<NoticeProbe />)
    expect(readProbe().status).toBe('success')

    mocks.kunFetchGet.mockResolvedValue('小喇叭暂时不可用，请稍后重试')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await flushNotify()
    expect(readProbe().status).toBe('error')
    expect(readProbe().hasData).toBe(true)
    expect(readProbe().error).toBe('小喇叭暂时不可用，请稍后重试')
    expect(noticed).toBe('小喇叭暂时不可用，请稍后重试')
  })

  it('stays pending on the first frame and never flashes an empty state before a response', async () => {
    let resolveFetch!: (value: ShoutboxListResponse) => void
    mocks.kunFetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
    )
    await renderTree(<ListProbe />)
    expect(readProbe().status).toBe('pending')
    expect(readProbe().ids).toBeNull()

    await act(async () => {
      resolveFetch(makeList())
      await Promise.resolve()
    })
    await flushNotify()
    expect(readProbe().status).toBe('success')
    expect(readProbe().ids).toEqual([])
  })

  it('projection hides an expired pin at render time without touching the cached payload', async () => {
    const pinned = {
      id: 900,
      user: { id: 9, name: '站长', avatar: '' },
      reportable: true,
      content: '置顶',
      link: '',
      official: true,
      level: 'important' as const,
      status: 0 as const,
      cost: 0,
      patch: null,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveTo: new Date(Date.now() + 3_600_000).toISOString(),
      editedAt: null,
      hiddenAt: null,
      refundedAt: null,
      created: new Date(Date.now() - 60_000).toISOString(),
      updated: new Date(Date.now() - 60_000).toISOString()
    }
    mocks.kunFetchGet.mockResolvedValue(
      makeList({
        pinned,
        shoutboxes: [],
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        visibilityUntil: new Date(Date.now() + 30_000).toISOString()
      })
    )
    await renderTree(
      <>
        <ListProbe />
        <WriteProbe />
      </>
    )
    expect(readProbe().pinned).toBe(900)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    await flushNotify()
    expect(readProbe().pinned).toBeNull()
    // The cache keeps the raw payload and its receive metadata.
    const cached = getClient().getQueryCache().getAll()[0]!.state
      .data as ShoutboxListResponse
    expect(cached.pinned?.id).toBe(900)
  })

  it('seeds only a brand-new matching query: an existing query is never overwritten by later initialData', async () => {
    mocks.kunFetchGet.mockResolvedValue(makeList())
    const SeededProbe = ({ note }: { note: string }) => {
      const query = useShoutboxQuery<ShoutboxListResponse>({
        view: 'list',
        project: projectShoutboxGlobalListDisplay,
        initialData: makeList({ page: note === 'first' ? 1 : 1 }),
        initialDataUpdatedAt: 0
      })
      void note
      return (
        <output>
          {JSON.stringify({
            status: query.status,
            ids: query.displayData?.shoutboxes ?? null
          })}
        </output>
      )
    }
    // First mount seeds from initialData: no GET at all while fresh.
    await renderTree(<SeededProbe note="first" />)
    expect(mocks.kunFetchGet).not.toHaveBeenCalled()
    expect(readProbe().status).toBe('success')

    // A remount with different initialData keeps the cached payload.
    await renderTree(<SeededProbe note="second" />)
    expect(mocks.kunFetchGet).not.toHaveBeenCalled()
    expect(readProbe().status).toBe('success')
  })

  it('an SSR seed past its validUntil refetches immediately, without the arrival backoff', async () => {
    mocks.kunFetchGet.mockResolvedValue(makeList())
    const ExpiredSeedProbe = () => {
      const query = useShoutboxQuery<ShoutboxListResponse>({
        view: 'list',
        project: projectShoutboxGlobalListDisplay,
        initialData: makeList({
          validUntil: new Date(Date.now() - 1000).toISOString()
        }),
        initialDataUpdatedAt: 0
      })
      return <output>{JSON.stringify({ status: query.status })}</output>
    }
    await renderTree(<ExpiredSeedProbe />)
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(readProbe().status).toBe('success')
  })
})
