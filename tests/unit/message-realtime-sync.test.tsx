import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const UNREAD_STATUS_TIMEOUT_MS = 10_000

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet
}))

describe('MessageRealtimeSync', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderSync = async (uid = 7) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { useUserStore } = await import('~/store/userStore')
    const { useMessageStore } = await import('~/store/messageStore')
    useUserStore.setState({
      user: {
        uid,
        name: uid ? 'Saya' : '',
        avatar: '',
        bio: '',
        moemoepoint: 0,
        role: 1,
        dailyCheckIn: 0,
        dailyImageLimit: 0,
        dailyUploadLimit: 0,
        enableEmailNotice: true,
        allowPrivateMessage: true,
        blockedTagIds: [],
        enableRedirect: true,
        excludedDomains: [],
        delaySeconds: 5
      }
    })
    useMessageStore.setState(
      {
        ...useMessageStore.getState(),
        hasUnreadNotification: false,
        hasUnreadConversation: false
      },
      true
    )

    const { MessageRealtimeSync } = await import(
      '~/components/message/MessageRealtimeSync'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<MessageRealtimeSync />)
    })

    return { useMessageStore, useUserStore }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.kunFetchGet.mockResolvedValue({
      hasUnreadMessages: true,
      hasUnreadChat: false
    })
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
    fetchMock.kunFetchGet.mockReset()
  })

  it('syncs unread status after login and on the visible polling interval', async () => {
    const { useMessageStore } = await renderSync()

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/unread',
      undefined,
      { timeout: UNREAD_STATUS_TIMEOUT_MS }
    )
    expect(useMessageStore.getState().hasUnreadNotification).toBe(true)
    expect(useMessageStore.getState().hasUnreadConversation).toBe(false)

    fetchMock.kunFetchGet.mockResolvedValueOnce({
      hasUnreadMessages: true,
      hasUnreadChat: true
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(useMessageStore.getState().hasUnreadConversation).toBe(true)
  })

  it('does not poll when logged out', async () => {
    await renderSync(0)

    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(fetchMock.kunFetchGet).not.toHaveBeenCalled()
  })

  it('fetches immediately when the page becomes visible again', async () => {
    await renderSync()

    await act(async () => {
      await Promise.resolve()
    })

    fetchMock.kunFetchGet.mockResolvedValueOnce({
      hasUnreadMessages: false,
      hasUnreadChat: true
    })

    Object.defineProperty(dom!.window.document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })

    await act(async () => {
      dom!.window.document.dispatchEvent(new dom!.window.Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(2)
  })

  it('shows the notification red dot on any page when new notifications arrive', async () => {
    fetchMock.kunFetchGet.mockResolvedValueOnce({
      hasUnreadMessages: false,
      hasUnreadChat: false
    })

    const { useMessageStore } = await renderSync()

    await act(async () => {
      await Promise.resolve()
    })

    expect(useMessageStore.getState().hasUnreadNotification).toBe(false)

    fetchMock.kunFetchGet.mockResolvedValueOnce({
      hasUnreadMessages: true,
      hasUnreadChat: false
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/unread',
      undefined,
      { timeout: UNREAD_STATUS_TIMEOUT_MS }
    )
    expect(useMessageStore.getState().hasUnreadNotification).toBe(true)
  })

  it('keeps the unread status request bounded by a timeout', async () => {
    fetchMock.kunFetchGet.mockResolvedValueOnce({
      hasUnreadMessages: true,
      hasUnreadChat: false
    })

    const { useMessageStore } = await renderSync()

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith(
      '/message/unread',
      undefined,
      { timeout: UNREAD_STATUS_TIMEOUT_MS }
    )
    expect(useMessageStore.getState().hasUnreadNotification).toBe(true)
  })
})
