import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@bprogress/next', () => ({ useRouter: () => navigation }))
vi.mock('~/hooks/useMounted', () => ({ useMounted: () => true }))
vi.mock('~/utils/sessionClient', () => ({ refreshUserSession: vi.fn() }))
vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />
}))

let dom: JSDOM
let root: Root
beforeEach(() => {
  vi.resetModules()
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
  it('preserves a draft on same-session refresh and infrastructure failure, then resets it after logout', async () => {
    const { useUserStore } = await import('~/store/userStore')
    const { SessionContentBoundary } = await import(
      '~/components/kun/SessionContentBoundary'
    )
    useUserStore.setState({
      sessionStatus: 'authenticated',
      sessionGeneration: 1
    })
    await act(async () =>
      root.render(
        <SessionContentBoundary>
          <textarea defaultValue="unsaved draft" />
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
