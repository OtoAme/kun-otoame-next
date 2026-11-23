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
  it('keeps the initial session placeholder consistent from server rendering through hydration', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { SessionContentBoundary } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    const page = (
      <SessionContentBoundary>
        <textarea defaultValue="server content" />
      </SessionContentBoundary>
    )
    const container = document.getElementById('root')!
    await act(async () => root.unmount())
    container.innerHTML = renderToString(page)
    const content = document.querySelector('textarea')!
    const recoverableError = vi.fn()

    expect(content.parentElement?.hidden).toBe(true)
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      '正在确认会话…'
    )

    await act(async () => {
      root = hydrateRoot(container, page, {
        onRecoverableError: recoverableError
      })
    })
    expect(document.querySelector('textarea')).toBe(content)
    expect(content.parentElement?.hidden).toBe(true)

    await act(async () => {
      useUserStore
        .getState()
        .acceptSession(
          { ...useUserStore.getState().user, uid: 7, name: 'synthetic' },
          'confirmed-session'
        )
    })
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

  it('preserves a draft on same-session refresh and infrastructure failure, then resets it after logout', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { SessionContentBoundary, useSessionContentReady } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    const ReadyProbe = () => <output>{String(useSessionContentReady())}</output>
    useUserStore.setState({
      sessionStatus: 'authenticated',
      sessionGeneration: 1
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
      expect(draft.parentElement?.hidden).toBe(status !== 'authenticated')
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
