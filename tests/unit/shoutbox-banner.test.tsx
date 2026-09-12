import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  pathname: '/'
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

vi.mock('@heroui/alert', () => ({
  Alert: ({
    description,
    closeButtonProps,
    onClose
  }: {
    description?: React.ReactNode
    closeButtonProps?: { 'aria-label'?: string }
    onClose?: () => void
  }) => (
    <div role="alert">
      {description}
      <button aria-label={closeButtonProps?.['aria-label']} onClick={onClose} />
    </div>
  )
}))

import { ShoutboxBanner } from '~/components/shoutbox/ShoutboxBanner'
import { SHOUTBOX_BANNER_DISMISS_STORAGE_KEY } from '~/hooks/useShoutboxBanner'
import type { ShoutboxBannerResponse, ShoutboxItem } from '~/types/api/shoutbox'

// The shared contract adds `visibilityUntil`: the server-known next real
// official boundary, never TTL-truncated. Tri-state — a string cleans up at
// that instant, null means no known boundary, an absent field (old payload)
// falls back to validUntil.
type BannerPayload = ShoutboxBannerResponse & {
  visibilityUntil?: string | null
}

const makeBanner = (id: number, effectiveToMs: number): ShoutboxItem => ({
  id,
  user: { id: 9, name: '站长', avatar: '' },
  content: `重要公告 ${id}`,
  link: '',
  official: true,
  level: 'important',
  status: 0,
  cost: 0,
  patch: null,
  effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
  effectiveTo: new Date(effectiveToMs).toISOString(),
  editedAt: null,
  hiddenAt: null,
  refundedAt: null,
  reportable: true,
  created: new Date(Date.now() - 60_000).toISOString(),
  updated: new Date(Date.now() - 60_000).toISOString()
})

describe('ShoutboxBanner', () => {
  let dom: JSDOM | undefined
  let root: Root | undefined
  let container: HTMLElement

  const renderBanner = async (options: { dismissedIds?: number[] } = {}) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // JSDOM defaults to "prerender"; the hook only revalidates on "visible".
    Object.defineProperty(dom.window.document, 'visibilityState', {
      value: 'visible',
      configurable: true
    })
    if (options.dismissedIds && options.dismissedIds.length > 0) {
      window.localStorage.setItem(
        SHOUTBOX_BANNER_DISMISS_STORAGE_KEY,
        JSON.stringify(options.dismissedIds)
      )
    }

    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<ShoutboxBanner />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.kunFetchGet.mockReset()
    mocks.pathname = '/'
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

  it('remembers dismissal per message id and shows the next important message again', async () => {
    // Responses are computed per call so their validUntil is always fresh,
    // matching the server contract (validUntil is strictly in the future).
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve({
        banner: makeBanner(7, Date.now() + 3_600_000),
        validUntil: new Date(Date.now() + 60_000).toISOString()
      })
    )
    await renderBanner({ dismissedIds: [5] })

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/shoutbox/banner')
    expect(container.textContent).toContain('重要公告 7')

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="关闭公告"]')
        ?.click()
    })
    expect(container.textContent).not.toContain('重要公告 7')
    expect(
      window.localStorage.getItem(SHOUTBOX_BANNER_DISMISS_STORAGE_KEY)
    ).toBe('[5,7]')

    // The refetch at the boundary still returns message 7: stays hidden.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(container.textContent).not.toContain('重要公告 7')

    // A NEW important message (new id) shows up again.
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve({
        banner: makeBanner(8, Date.now() + 3_600_000),
        validUntil: new Date(Date.now() + 60_000).toISOString()
      })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(container.textContent).toContain('重要公告 8')
  })

  it('keeps an earlier dismissed banner dismissed when a newer one supersedes and then ends', async () => {
    // A (id 7) is dismissed; B (id 8) supersedes it and is dismissed too.
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve({
        banner: makeBanner(7, Date.now() + 3_600_000),
        validUntil: new Date(Date.now() + 60_000).toISOString()
      })
    )
    await renderBanner({ dismissedIds: [7] })
    expect(container.textContent).not.toContain('重要公告 7')

    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve({
        banner: makeBanner(8, Date.now() + 3_600_000),
        validUntil: new Date(Date.now() + 60_000).toISOString()
      })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(container.textContent).toContain('重要公告 8')

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="关闭公告"]')
        ?.click()
    })
    expect(
      window.localStorage.getItem(SHOUTBOX_BANNER_DISMISS_STORAGE_KEY)
    ).toBe('[7,8]')

    // B ends while A is still effective: the banner falls back to A, and A
    // must stay dismissed.
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve({
        banner: makeBanner(7, Date.now() + 3_600_000),
        validUntil: new Date(Date.now() + 60_000).toISOString()
      })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(container.textContent).not.toContain('重要公告 7')
    expect(container.textContent).not.toContain('重要公告 8')
  })

  it('drops the expired banner BEFORE the refetch resolves at validUntil', async () => {
    let resolveSecond!: (value: unknown) => void
    const second = new Promise((resolve) => {
      resolveSecond = resolve
    })
    mocks.kunFetchGet
      .mockResolvedValueOnce({
        banner: makeBanner(7, Date.now() + 30_000),
        validUntil: new Date(Date.now() + 30_000).toISOString()
      })
      .mockImplementationOnce(() => second)
    await renderBanner()
    expect(container.textContent).toContain('重要公告 7')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    // The old banner is gone while the refetch is still in flight.
    expect(container.textContent).not.toContain('重要公告 7')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveSecond({
        banner: null,
        validUntil: new Date(Date.now() + 60_000).toISOString()
      })
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('重要公告 7')
  })

  it('revalidates the held payload against the current time on visibility restore', async () => {
    mocks.kunFetchGet.mockResolvedValue({
      banner: makeBanner(7, Date.now() + 300_000),
      validUntil: new Date(Date.now() + 60_000).toISOString()
    })
    await renderBanner()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // Still valid: a visibility restore does not refetch.
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('重要公告 7')

    // Move the clock past validUntil without firing the pending boundary
    // timer (as if the tab had been suspended): the restore handler drops the
    // payload first, then refetches.
    vi.setSystemTime(Date.now() + 120_000)
    mocks.kunFetchGet.mockResolvedValueOnce({
      banner: null,
      validUntil: new Date(Date.now() + 60_000).toISOString()
    })
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('重要公告 7')
  })

  it('never fetches or renders on the admin preview pages', async () => {
    mocks.pathname = '/preview/submission/12'
    await renderBanner()
    expect(mocks.kunFetchGet).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')

    mocks.pathname = '/preview/resource/3'
    await act(async () => {
      root!.render(<ShoutboxBanner />)
      await Promise.resolve()
    })
    expect(mocks.kunFetchGet).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')
  })
  it('retains a slow response past cache freshness but clears it at the true boundary', async () => {
    mocks.kunFetchGet
      .mockResolvedValueOnce({
        banner: makeBanner(7, Date.now() + 60_000),
        validUntil: new Date(Date.now() - 1).toISOString(),
        visibilityUntil: new Date(Date.now() + 1000).toISOString()
      } satisfies BannerPayload)
      .mockResolvedValue('暂时失败')
    await renderBanner()
    expect(container.textContent).toContain('重要公告 7')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(container.textContent).not.toContain('重要公告 7')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
  })

  it('coalesces visibility refreshes and cancels their work when the banner becomes disabled', async () => {
    let resolveFirst!: (value: ShoutboxBannerResponse) => void
    const payload: ShoutboxBannerResponse = {
      banner: makeBanner(7, Date.now() + 60_000),
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      visibilityUntil: null
    }
    mocks.kunFetchGet
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValue(payload)
    await renderBanner()
    await act(async () => {
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
    })
    mocks.pathname = '/preview/submission/12'
    await act(async () => {
      root!.render(<ShoutboxBanner />)
    })
    await act(async () => {
      resolveFirst(payload)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('')
  })
})
