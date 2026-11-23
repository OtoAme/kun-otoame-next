import React, { act } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NsfwMode, PreferenceSnapshot } from '~/types/api/preferences'

const fetchList = vi.hoisted(() => vi.fn())
vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: fetchList }))

const scope = { identity: 'confirmed-context', browsingKey: '["all",[]]' }
const initialData = {
  galgames: [{ id: 1, name: 'server list' } as GalgameCard],
  total: 1
}
const snapshot = (mode: NsfwMode = 'all', version = 0): PreferenceSnapshot => ({
  uid: 7,
  context: scope.identity,
  version,
  nsfwSelected: true,
  blockedTagIds: [],
  items: { nsfw: { value: mode, version } }
})

let root: Root
let dom: JSDOM
beforeEach(() => {
  vi.resetModules()
  fetchList.mockReset()
  dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/otomegame'
  })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  dom.window.close()
  vi.unstubAllGlobals()
})

const setup = async () => {
  const { useUserStore } = await import('~/store/userStore')
  const { usePreferenceStore } = await import('~/store/preferenceStore')
  const { useGalgameList } = await import('~/hooks/useGalgameList')
  const { useGalgameFilters } = await import('~/hooks/useGalgameFilters')
  const { getGalgameListQuery } = await import('~/utils/galgameFilter')
  const Probe = ({ seeded = true }: { seeded?: boolean }) => {
    const { filters, filterProps } = useGalgameFilters(undefined, 10)
    const result = useGalgameList(
      '/otomegame',
      getGalgameListQuery(filters),
      initialData,
      seeded ? scope : null
    )
    return (
      <>
        <button onClick={() => filterProps.setSortField('created')}>
          sort
        </button>
        <button onClick={result.retry}>retry</button>
        <div>
          {result.error
            ? 'failed'
            : result.loading
              ? 'loading'
              : result.galgames.map((game) => (
                  <article key={game.id}>{game.name}</article>
                ))}
        </div>
      </>
    )
  }
  const authenticate = () =>
    useUserStore.setState({
      sessionStatus: 'authenticated',
      sessionGeneration: 0,
      sessionContext: scope.identity,
      user: { ...useUserStore.getState().user, uid: 7 }
    })
  const confirmPreferences = (mode: NsfwMode = 'all', version = 0) =>
    usePreferenceStore.setState({
      generation: 0,
      status: 'ready',
      applied: snapshot(mode, version)
    })
  return {
    useUserStore,
    usePreferenceStore,
    Probe,
    authenticate,
    confirmPreferences
  }
}

describe('server list handoff and repeated confirmation', () => {
  it('hides an old server list when first client confirmation finds a different account', async () => {
    const { Probe, useUserStore } = await setup()
    root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<Probe />))
    expect(document.body.textContent).toContain('server list')
    await act(async () =>
      useUserStore.getState().acceptSession(
        {
          ...useUserStore.getState().user,
          uid: 8
        },
        'new-context'
      )
    )
    expect(document.body.textContent).not.toContain('server list')
    await act(async () =>
      useUserStore.getState().setSessionStatus('unavailable')
    )
    expect(document.body.textContent).not.toContain('server list')
    expect(fetchList).not.toHaveBeenCalled()
  })

  it('keeps the server DOM through hydration, identity confirmation and delayed preference confirmation', async () => {
    const { Probe, authenticate, confirmPreferences, useUserStore } =
      await setup()
    const container = document.getElementById('root')!
    const page = (
      <React.StrictMode>
        <Probe />
      </React.StrictMode>
    )
    container.innerHTML = renderToString(page)
    const card = container.querySelector('article')
    expect(card?.textContent).toBe('server list')
    const hydrationError = vi.fn()
    await act(async () => {
      root = hydrateRoot(container, page, {
        onRecoverableError: hydrationError
      })
    })
    await act(async () =>
      useUserStore.getState().setSessionStatus('unavailable')
    )
    expect(container.querySelector('article')).toBe(card)
    await act(async () => authenticate())
    expect(container.querySelector('article')).toBe(card)
    await act(async () => confirmPreferences())
    for (const status of [
      'checking',
      'authenticated',
      'unavailable',
      'authenticated'
    ] as const) {
      await act(async () => useUserStore.getState().setSessionStatus(status))
      expect(container.querySelector('article')).toBe(card)
    }
    expect(fetchList).not.toHaveBeenCalled()
    expect(hydrationError).not.toHaveBeenCalled()
  })

  it('fetches once after a real preference change and shares the request through session rechecks', async () => {
    const { Probe, authenticate, confirmPreferences, useUserStore } =
      await setup()
    authenticate()
    confirmPreferences()
    let complete!: (value: unknown) => void
    fetchList.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      })
    )
    root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<Probe />))
    await act(async () => confirmPreferences('sfw', 1))
    await act(async () => useUserStore.getState().setSessionStatus('checking'))
    await act(async () =>
      useUserStore.getState().setSessionStatus('authenticated')
    )
    expect(fetchList).toHaveBeenCalledTimes(1)
    await act(async () =>
      complete({ galgames: [{ id: 2, name: 'new preference list' }], total: 1 })
    )
    await act(async () => confirmPreferences('sfw', 2))
    expect(document.body.textContent).toContain('new preference list')
    expect(fetchList).toHaveBeenCalledTimes(1)
  })

  it('updates the filter URL once and restores filters with browser history without loading a second server page', async () => {
    const { Probe, authenticate, confirmPreferences } = await setup()
    authenticate()
    confirmPreferences()
    fetchList.mockResolvedValue({
      galgames: [{ id: 2, name: 'sorted list' }],
      total: 1
    })
    const push = vi.spyOn(window.history, 'pushState')
    root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<Probe />))
    expect(push).not.toHaveBeenCalled()
    await act(async () => document.querySelector('button')!.click())
    expect(window.location.search).toBe('?sortField=created')
    expect(push).toHaveBeenCalledTimes(1)
    expect(fetchList).toHaveBeenCalledTimes(1)
    await act(async () => document.querySelector('button')!.click())
    expect(fetchList).toHaveBeenCalledTimes(1)
    window.history.replaceState(null, '', '/otomegame?page=2')
    await act(async () =>
      window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
    )
    expect(fetchList).toHaveBeenCalledTimes(2)
    expect(fetchList).toHaveBeenLastCalledWith(
      '/otomegame',
      expect.objectContaining({ page: 2, sortField: 'resource_update_time' })
    )
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('shares a first client request under StrictMode and permits manual retry after failure', async () => {
    const { Probe, authenticate, confirmPreferences, useUserStore } =
      await setup()
    authenticate()
    confirmPreferences()
    fetchList.mockRejectedValueOnce(new Error('synthetic outage'))
    root = createRoot(document.getElementById('root')!)
    await act(async () =>
      root.render(
        <React.StrictMode>
          <Probe seeded={false} />
        </React.StrictMode>
      )
    )
    expect(fetchList).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('failed')
    await act(async () => useUserStore.getState().setSessionStatus('checking'))
    await act(async () =>
      useUserStore.getState().setSessionStatus('authenticated')
    )
    expect(fetchList).toHaveBeenCalledTimes(1)
    fetchList.mockResolvedValueOnce({
      galgames: [{ id: 2, name: 'retried list' }],
      total: 1
    })
    await act(async () => document.querySelectorAll('button')[1].click())
    expect(fetchList).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('retried list')
  })
})
