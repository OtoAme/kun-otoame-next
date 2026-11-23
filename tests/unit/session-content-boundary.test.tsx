import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@bprogress/next', () => ({ useRouter: () => navigation }))
vi.mock('~/utils/sessionClient', () => ({ refreshUserSession: vi.fn() }))
vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />
}))

let dom: JSDOM
let root: Root
beforeEach(() => {
  vi.resetModules()
  navigation.refresh.mockReset()
  dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  root = createRoot(document.getElementById('root')!)
})
afterEach(async () => {
  await act(async () => root.unmount())
  dom.window.close()
  vi.unstubAllGlobals()
})

describe('personalized content lifecycle', () => {
  it('preserves a verified anonymous server page through its first client confirmation', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { SessionRenderProvider } = await import(
      '~/components/kun/SessionRenderProvider'
    )
    const { SessionContentBoundary } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    const page = (
      <SessionRenderProvider
        initialState={{ identity: 'guest', browsingKey: '["sfw",[]]' }}
      >
        <SessionContentBoundary>
          <textarea defaultValue="server draft" />
        </SessionContentBoundary>
      </SessionRenderProvider>
    )
    const container = document.getElementById('root')!
    await act(async () => root.unmount())
    container.innerHTML = renderToString(page)
    const draft = document.querySelector('textarea')!
    expect(draft.parentElement?.hidden).toBe(false)
    await act(async () => {
      root = hydrateRoot(container, page)
    })
    await act(async () => useUserStore.getState().confirmGuest())
    expect(document.querySelector('textarea')).toBe(draft)
    expect(draft.parentElement?.hidden).toBe(false)
    expect(navigation.refresh).not.toHaveBeenCalled()
  })

  it('refreshes previously authenticated server content when initial client verification finds a guest', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { SessionRenderProvider } = await import(
      '~/components/kun/SessionRenderProvider'
    )
    const { SessionContentBoundary } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    await act(async () =>
      root.render(
        <SessionRenderProvider
          initialState={{
            identity: 'server-session',
            browsingKey: '["sfw",[]]'
          }}
        >
          <SessionContentBoundary>
            <textarea defaultValue="account draft" />
          </SessionContentBoundary>
        </SessionRenderProvider>
      )
    )
    const draft = document.querySelector('textarea')!
    await act(async () => useUserStore.getState().confirmGuest())
    expect(draft.isConnected).toBe(false)
    expect(navigation.refresh).toHaveBeenCalledOnce()
  })

  it('preserves authenticated server content through hydration and delayed preference recovery', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    const { SessionRenderProvider } = await import(
      '~/components/kun/SessionRenderProvider'
    )
    const { SessionContentBoundary } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    const page = (
      <SessionRenderProvider
        initialState={{
          identity: 'confirmed-session',
          browsingKey: '["sfw",[]]'
        }}
      >
        <SessionContentBoundary>
          <textarea defaultValue="server content" />
        </SessionContentBoundary>
      </SessionRenderProvider>
    )
    const container = document.getElementById('root')!
    await act(async () => root.unmount())
    container.innerHTML = renderToString(page)
    const content = document.querySelector('textarea')!
    const recoverableError = vi.fn()

    expect(content.parentElement?.hidden).toBe(false)

    await act(async () => {
      root = hydrateRoot(container, page, {
        onRecoverableError: recoverableError
      })
    })
    expect(document.querySelector('textarea')).toBe(content)
    expect(content.parentElement?.hidden).toBe(false)

    await act(async () => {
      useUserStore
        .getState()
        .acceptSession(
          { ...useUserStore.getState().user, uid: 7, name: 'synthetic' },
          'confirmed-session'
        )
    })
    expect(content.parentElement?.hidden).toBe(false)
    await act(async () =>
      usePreferenceStore.setState({
        generation: 0,
        status: 'ready',
        applied: {
          uid: 7,
          context: 'confirmed-session',
          version: 0,
          nsfwSelected: false,
          blockedTagIds: [],
          items: { nsfw: { value: 'sfw', version: 0 } }
        }
      })
    )
    expect(document.querySelector('textarea')).toBe(content)
    expect(content.parentElement?.hidden).toBe(false)
    expect(document.querySelector('[role="status"]')).toBeNull()
    expect(navigation.refresh).not.toHaveBeenCalled()
    expect(recoverableError).not.toHaveBeenCalled()
  })

  it('preserves public page input when the initial visitor is confirmed as a guest', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { SessionContentBoundary } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    await act(async () =>
      root.render(
        <SessionContentBoundary personalized={false}>
          <input aria-label="Username" defaultValue="" />
        </SessionContentBoundary>
      )
    )
    const input = document.querySelector('input')!
    input.value = 'unfinished sign-in'

    await act(async () => useUserStore.getState().logout())

    expect(document.querySelector('input')).toBe(input)
    expect(input.value).toBe('unfinished sign-in')
    expect(input.parentElement?.hidden).toBe(false)
    expect(navigation.refresh).not.toHaveBeenCalled()
  })

  it('preserves public content across account changes and refreshes later personalized content on logout', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { SessionContentBoundary } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    await act(async () =>
      root.render(
        <SessionContentBoundary personalized={false}>
          <textarea defaultValue="public draft" />
        </SessionContentBoundary>
      )
    )
    const publicDraft = document.querySelector('textarea')!
    for (const uid of [7, 8]) {
      await act(async () => {
        useUserStore
          .getState()
          .acceptSession(
            { ...useUserStore.getState().user, uid, name: 'synthetic' },
            `session-${uid}`
          )
      })
      expect(document.querySelector('textarea')).toBe(publicDraft)
    }
    expect(navigation.refresh).not.toHaveBeenCalled()

    await act(async () =>
      root.render(
        <SessionContentBoundary>
          <textarea defaultValue="personal draft" />
        </SessionContentBoundary>
      )
    )
    const personalDraft = document.querySelector('textarea')!
    await act(async () => useUserStore.getState().logout())
    expect(personalDraft.isConnected).toBe(false)
    expect(navigation.refresh).toHaveBeenCalledOnce()
  })

  it('defaults to ready outside a personalized boundary', async () => {
    const { useSessionContentReady } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    const ReadyProbe = () => <output>{String(useSessionContentReady())}</output>
    await act(async () => root.render(<ReadyProbe />))
    expect(document.querySelector('output')?.textContent).toBe('true')
  })

  it('keeps account settings ready without browsing preferences and avoids refreshing them on preference changes', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    const { SessionContentBoundary, useSessionContentReady } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    const Ready = () => <output>{String(useSessionContentReady())}</output>
    useUserStore.setState({
      sessionStatus: 'authenticated',
      sessionContext: 'settings-session',
      user: { ...useUserStore.getState().user, uid: 7 }
    })
    await act(async () =>
      root.render(
        <SessionContentBoundary usesBrowsingPreferences={false}>
          <textarea defaultValue="settings draft" />
          <Ready />
        </SessionContentBoundary>
      )
    )
    const draft = document.querySelector('textarea')!
    expect(document.querySelector('output')?.textContent).toBe('true')
    for (const mode of ['sfw', 'all'] as const) {
      await act(async () =>
        usePreferenceStore.setState({
          generation: 0,
          status: 'ready',
          applied: {
            uid: 7,
            context: 'settings-session',
            version: 1,
            nsfwSelected: true,
            blockedTagIds: [],
            items: { nsfw: { value: mode, version: 1 } }
          }
        })
      )
      expect(document.querySelector('textarea')).toBe(draft)
      expect(draft.parentElement?.hidden).toBe(false)
    }
    expect(navigation.refresh).not.toHaveBeenCalled()
  })

  it('preserves a draft on same-session refresh and infrastructure failure, then resets it after logout', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    const { SessionContentBoundary, useSessionContentReady } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    const ReadyProbe = () => <output>{String(useSessionContentReady())}</output>
    useUserStore.setState({
      sessionStatus: 'authenticated',
      sessionGeneration: 1,
      sessionContext: 'test-context',
      user: { ...useUserStore.getState().user, uid: 7 }
    })
    usePreferenceStore.setState({
      generation: 1,
      status: 'ready',
      applied: {
        uid: 7,
        context: 'test-context',
        version: 0,
        nsfwSelected: false,
        blockedTagIds: [],
        items: { nsfw: { value: 'sfw', version: 0 } }
      }
    })
    await act(async () =>
      root.render(
        <SessionContentBoundary>
          <textarea defaultValue="unsaved draft" />
          <ReadyProbe />
        </SessionContentBoundary>
      )
    )
    const draft = document.querySelector('textarea')!
    for (const status of [
      'checking',
      'unavailable',
      'authenticated'
    ] as const) {
      await act(async () => useUserStore.getState().setSessionStatus(status))
      expect(document.querySelector('textarea')).toBe(draft)
      expect(draft.value).toBe('unsaved draft')
      expect(document.querySelector('output')?.textContent).toBe(
        String(status === 'authenticated')
      )
      expect(draft.parentElement?.hidden).toBe(false)
    }
    await act(async () => useUserStore.getState().logout())
    expect(draft.isConnected).toBe(false)
    expect(navigation.refresh).toHaveBeenCalled()
  })

  it('keeps static public content and sign-in entry visible while identity is unavailable', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { SessionContentBoundary } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    useUserStore.setState({ sessionStatus: 'unavailable' })
    await act(async () =>
      root.render(
        <>
          <a href="/login">登录</a>
          <SessionContentBoundary personalized={false}>
            <p>static public content</p>
          </SessionContentBoundary>
        </>
      )
    )
    expect(document.querySelector('p')?.parentElement?.hidden).toBe(false)
    expect(document.querySelector('a[href="/login"]')).not.toBeNull()
  })
})
