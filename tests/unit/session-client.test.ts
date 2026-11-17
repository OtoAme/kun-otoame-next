import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }))
let dom: JSDOM
const transport = vi.fn()

beforeEach(() => {
  vi.resetModules()
  transport.mockReset()
  dom = new JSDOM('', { url: 'https://example.test/settings/user' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('fetch', transport)
})
afterEach(() => {
  dom.window.close()
  vi.unstubAllGlobals()
})

const setup = async () => {
  const { useUserStore } = await import('~/store/userStore')
  const { useSettingStore } = await import('~/store/settingStore')
  const { useMessageStore } = await import('~/store/messageStore')
  const client = await import('~/utils/sessionClient')
  const user = {
    ...useUserStore.getState().user,
    uid: 7,
    name: 'synthetic',
    blockedTagIds: [7]
  }
  useUserStore.setState({
    user,
    sessionStatus: 'authenticated',
    sessionContext: 'verified-context',
    sessionGeneration: 1
  })
  useSettingStore
    .getState()
    .setData({ kunNsfwEnable: 'all', kunBlockedTagIds: [7] })
  useMessageStore.getState().setUnreadMessageStatus({
    hasUnreadNotification: true,
    hasUnreadConversation: true
  })
  return { ...client, useUserStore, useSettingStore, useMessageStore, user }
}

describe('session client identity and cleanup', () => {
  it('reuses an in-flight refresh and retains old summary when unread is null', async () => {
    const state = await setup()
    let resolve!: (response: Response) => void
    transport.mockImplementationOnce(
      () =>
        new Promise<Response>((complete) => {
          resolve = complete
        })
    )
    const first = state.refreshUserSession()
    expect(state.refreshUserSession()).toBe(first)
    resolve(
      Response.json({
        user: state.user,
        context: 'verified-context',
        unread: null
      })
    )
    await first
    expect(transport).toHaveBeenCalledTimes(1)
    expect(state.useMessageStore.getState().hasUnreadNotification).toBe(true)
    expect(state.useUserStore.getState()).toMatchObject({
      sessionStatus: 'authenticated',
      sessionGeneration: 1
    })
    expect(state.useSettingStore.getState().data.kunNsfwEnable).toBe('all')
  })

  it('preserves confirmed account and local preferences on infrastructure failure', async () => {
    const state = await setup()
    const cookies = document.cookie
    transport.mockResolvedValueOnce(
      Response.json({ code: 'SESSION_UNAVAILABLE' }, { status: 503 })
    )
    await state.refreshUserSession()
    expect(state.useUserStore.getState()).toMatchObject({
      user: { uid: 7 },
      sessionStatus: 'unavailable',
      sessionContext: 'verified-context',
      sessionGeneration: 1
    })
    expect(document.cookie).toBe(cookies)
    expect(state.useMessageStore.getState().hasUnreadNotification).toBe(true)
  })

  it.each([true, false])(
    'ignores a late %s response after another login with the same uid',
    async (success) => {
      const state = await setup()
      let resolve!: (response: Response) => void
      transport.mockImplementationOnce(
        () =>
          new Promise<Response>((complete) => {
            resolve = complete
          })
      )
      const first = state.refreshUserSession()
      state.useUserStore
        .getState()
        .setLoginUser({ ...state.user, name: 'new-session' })
      const generation = state.useUserStore.getState().sessionGeneration
      resolve(
        success
          ? Response.json({
              user: state.user,
              context: 'old-context',
              unread: {
                hasUnreadNotification: true,
                hasUnreadConversation: true
              }
            })
          : Response.json({ code: 'SESSION_INVALID' }, { status: 401 })
      )
      await first
      expect(state.useUserStore.getState()).toMatchObject({
        user: { name: 'new-session' },
        sessionStatus: 'checking',
        sessionGeneration: generation,
        sessionContext: null
      })
      expect(state.useMessageStore.getState().hasUnreadNotification).toBe(false)
    }
  )

  it('refreshes initial server content when revocation is discovered before client identity is confirmed', async () => {
    const state = await setup()
    state.useUserStore.setState({
      user: { ...state.user, uid: 0 },
      sessionContext: null,
      sessionStatus: 'checking',
      sessionGeneration: 0
    })
    transport.mockImplementation(() =>
      Promise.resolve(
        Response.json({ code: 'SESSION_INVALID' }, { status: 401 })
      )
    )
    await state.refreshUserSession()
    expect(state.useUserStore.getState()).toMatchObject({
      sessionStatus: 'guest',
      sessionGeneration: 1
    })
    await state.refreshUserSession()
    expect(state.useUserStore.getState().sessionGeneration).toBe(1)
  })

  it('clears cookies at their root path and keeps guest defaults absent after later writes', async () => {
    const state = await setup()
    expect(document.cookie).toContain('kunNsfwEnable=all')
    state.useUserStore.getState().logout()
    expect(document.cookie).not.toContain('kun-patch-setting-store')
    state.useUserStore
      .getState()
      .setMoemoepointBalance({ total: 0, reserved: 0, available: 0 })
    state.useSettingStore.getState().resetData()
    expect(document.cookie).not.toContain('kun-patch-setting-store')
    expect(state.useMessageStore.getState()).toMatchObject({
      hasUnreadNotification: false,
      hasUnreadConversation: false
    })
    expect(state.useUserStore.getState().sessionGeneration).toBe(2)
  })

  it('expresses failed server revocation while clearing the local account', async () => {
    const state = await setup()
    transport.mockResolvedValueOnce(
      Response.json(
        { revoked: false, message: 'server revocation unconfirmed' },
        { status: 503 }
      )
    )
    expect(await state.requestUserLogout()).toEqual({
      revoked: false,
      message: 'server revocation unconfirmed'
    })
    expect(state.useUserStore.getState()).toMatchObject({
      user: { uid: 0 },
      sessionStatus: 'guest'
    })
    expect(document.cookie).not.toContain('kun-patch-setting-store')
  })

  it('does not claim logout completion when the request never reached the server', async () => {
    const state = await setup()
    transport.mockRejectedValueOnce(new Error('network offline'))
    await expect(state.requestUserLogout()).rejects.toThrow('network offline')
    expect(state.useUserStore.getState().user.uid).toBe(7)
  })
})
