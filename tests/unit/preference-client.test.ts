import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import type { PreferenceSnapshot } from '~/types/api/preferences'
let dom: JSDOM
const transport = vi.fn()
const context = 'a'.repeat(64)
const snapshot = (
  version = 0,
  mode: 'sfw' | 'nsfw' | 'all' = 'sfw'
): PreferenceSnapshot => ({
  uid: 7,
  context,
  version,
  nsfwSelected: version > 0,
  blockedTagIds: [],
  items: {
    nsfw: { value: mode, version },
    'email-notice': { value: false, version: 0 }
  }
})
beforeEach(() => {
  vi.resetModules()
  transport.mockReset()
  dom = new JSDOM('', { url: 'https://example.test/settings/user' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('fetch', transport)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  dom.window.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const setup = async () => {
  const { useUserStore } = await import('~/store/userStore')
  useUserStore.setState({
    user: { ...useUserStore.getState().user, uid: 7 },
    sessionStatus: 'authenticated',
    sessionContext: context,
    sessionGeneration: 1
  })
  const { usePreferenceStore } = await import('~/store/preferenceStore')
  const client = await import('~/utils/preferenceClient')
  transport.mockResolvedValueOnce(Response.json(snapshot()))
  await client.refreshPreferences()
  return { ...client, useUserStore, usePreferenceStore }
}
describe('account preference client drafts and applied snapshots', () => {
  it('keeps legacy Cookie as an explicit import candidate and performs no implicit write', async () => {
    document.cookie =
      'kun-patch-setting-store|state|data|kunNsfwEnable=all; Path=/'
    const { useSettingStore } = await import('~/store/settingStore')
    useSettingStore.getState().resetData()
    const state = await setup()
    expect(state.usePreferenceStore.getState()).toMatchObject({
      legacyNsfw: 'all',
      applied: { nsfwSelected: false, items: { nsfw: { value: 'sfw' } } }
    })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][1].method).toBe('GET')
    expect(document.cookie).not.toContain('kunNsfwEnable')
  })
  it('separates drafts from background snapshots and only advances applied version after a successful read', async () => {
    const state = await setup()
    state.editPreference('nsfw', 'all')
    transport.mockRejectedValueOnce(new TypeError('synthetic offline'))
    state.observePreferenceVersion(3)
    await state.refreshPreferences()
    expect(state.usePreferenceStore.getState()).toMatchObject({
      observedVersion: 3,
      applied: { version: 0 },
      drafts: { nsfw: { value: 'all', version: 0 } }
    })
    transport.mockResolvedValueOnce(Response.json(snapshot(3, 'nsfw')))
    await state.refreshPreferences()
    expect(state.usePreferenceStore.getState()).toMatchObject({
      applied: { version: 3 },
      drafts: { nsfw: { value: 'all', version: 0 } }
    })
  })
  it.each([false, true])(
    'rejects an old draft without a request after account/session change (same account=%s)',
    async (sameAccount) => {
      const state = await setup()
      state.editPreference('nsfw', 'all')
      state.useUserStore.setState({
        user: {
          ...state.useUserStore.getState().user,
          uid: sameAccount ? 7 : 8
        },
        sessionContext: 'b'.repeat(64),
        sessionGeneration: 2
      })
      expect(await state.savePreferenceDrafts()).toBe(false)
      expect(transport).toHaveBeenCalledTimes(1)
    }
  )
  it('coalesces identical reads and discards a late response from a previous session', async () => {
    const state = await setup()
    let complete!: (response: Response) => void
    transport.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve
        })
    )
    const first = state.refreshPreferences()
    expect(state.refreshPreferences()).toBe(first)
    state.useUserStore.setState({
      sessionContext: 'b'.repeat(64),
      sessionGeneration: 2
    })
    complete(Response.json(snapshot(9, 'all')))
    await first
    expect(state.usePreferenceStore.getState().applied?.version).toBe(0)
  })
  it('keeps a failed offline draft and never automatically replays writes', async () => {
    const state = await setup()
    state.editPreference('nsfw', 'all')
    transport.mockRejectedValueOnce(new TypeError('synthetic offline'))
    expect(await state.savePreferenceDrafts()).toBe(false)
    window.dispatchEvent(new dom.window.Event('online'))
    expect(transport).toHaveBeenCalledTimes(2)
    expect(state.usePreferenceStore.getState().drafts.nsfw.value).toBe('all')
  })
  it('preserves conflict input until explicit confirmation updates its item version', async () => {
    const state = await setup()
    state.editPreference('nsfw', 'all')
    transport.mockResolvedValueOnce(
      Response.json(
        {
          code: 'PREFERENCE_CONFLICT',
          message: 'conflict',
          conflicts: ['nsfw'],
          snapshot: snapshot(2, 'nsfw')
        },
        { status: 409 }
      )
    )
    expect(await state.savePreferenceDrafts()).toBe(false)
    expect(state.usePreferenceStore.getState()).toMatchObject({
      conflicts: ['nsfw'],
      drafts: { nsfw: { value: 'all', version: 0 } },
      applied: { version: 2 }
    })
    state.confirmPreferenceConflicts()
    transport.mockResolvedValueOnce(Response.json(snapshot(3, 'all')))
    expect(await state.savePreferenceDrafts()).toBe(true)
    expect(JSON.parse(transport.mock.calls[2][1].body)).toMatchObject({
      uid: 7,
      context,
      changes: [{ key: 'nsfw', value: 'all', version: 2 }]
    })
    expect(state.usePreferenceStore.getState().drafts).toEqual({})
  })
  it('reads bounded candidate tag versions without losing the selected snapshot', async () => {
    const state = await setup()
    transport.mockResolvedValueOnce(
      Response.json({
        ...snapshot(),
        items: {
          ...snapshot().items,
          'blocked-tag:19': { value: false, version: 4 }
        }
      })
    )
    await state.refreshPreferences([19])
    expect(transport.mock.calls[1][0]).toBe('/api/user/preferences?tagId=19')
    state.editPreference('blocked-tag:19', true)
    expect(
      state.usePreferenceStore.getState().drafts['blocked-tag:19']
    ).toMatchObject({ version: 4, value: true })
  })
  it('settles a stale read without replacing an already newer applied snapshot', async () => {
    const state = await setup()
    transport.mockResolvedValueOnce(Response.json(snapshot(3, 'all')))
    await state.refreshPreferences()
    transport.mockResolvedValueOnce(Response.json(snapshot(1, 'sfw')))
    await state.refreshPreferences()
    expect(state.usePreferenceStore.getState()).toMatchObject({
      status: 'ready',
      applied: { version: 3, items: { nsfw: { value: 'all' } } }
    })
  })
})
