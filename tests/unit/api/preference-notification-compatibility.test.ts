import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { NOTIFICATION_SUBSCRIPTIONS } from '~/constants/notification'
import { preferenceSnapshotSchema } from '~/validations/preferences'
import { useUserStore } from '~/store/userStore'
import { resetPreferences, usePreferenceStore } from '~/store/preferenceStore'
import { useSettingStore } from '~/store/settingStore'
import type { PreferenceSnapshot } from '~/types/api/preferences'

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
vi.mock('~/prisma', () => ({ prisma: {} }))
vi.mock('~/app/api/utils/sessionIdentity', () => ({
  getRequestIdentity: async () => ({
    status: 'authenticated',
    payload: { uid: 7 }
  }),
  requireAvailableIdentity: (identity: { payload: unknown }) =>
    identity.payload,
  getSessionContext: () => 'a'.repeat(64)
}))
vi.mock('~/lib/accountPreferences/service', () => ({
  readPreferenceSnapshot: mocks.read,
  saveAccountPreferences: mocks.save,
  PreferenceError: class extends Error {}
}))
import { GET, PATCH } from '~/app/api/user/preferences/route'

const context = 'a'.repeat(64)
const complete = (version = 0): PreferenceSnapshot => ({
  uid: 7,
  context,
  version,
  nsfwSelected: true,
  blockedTagIds: [7],
  items: {
    nsfw: { value: 'sfw', version },
    'email-notice': { value: true, version },
    'blocked-tag:7': { value: true, version },
    'blocked-tag:19': { value: false, version },
    ...Object.fromEntries(
      NOTIFICATION_SUBSCRIPTIONS.map((key) => [key, { value: false, version }])
    )
  }
})
const request = (method: string, url: string, body?: unknown) =>
  new NextRequest(`http://localhost/api${url}`, {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' }
        }
      : {})
  })
class LegacyFetchError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super('synthetic transport response')
  }
}
const transport = async (method: string, url: string, body?: unknown) => {
  const response = await (method === 'GET' ? GET : PATCH)(
    request(method, url, body)
  )
  const result = await response.json()
  if (!response.ok) throw new LegacyFetchError(response.status, result)
  return result
}
const loadLegacy = () => {
  const nodeRequire = createRequire(import.meta.url)
  const modules = new Map<string, unknown>()
  const evaluate = (
    filename: string,
    dependencies: Record<string, unknown>
  ) => {
    const source = readFileSync(
      new URL(
        `../../fixtures/account-preferences-94eea5a2/${filename.split('/').at(-1)}.txt`,
        import.meta.url
      ),
      'utf8'
    )
    const output = transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText
    const exports = {}
    new Function('require', 'exports', output)(
      (name: string) =>
        dependencies[name] ?? modules.get(name) ?? nodeRequire(name),
      exports
    )
    return exports
  }
  const schemas = evaluate('validations/preferences.ts', {})
  modules.set('~/validations/preferences', schemas)
  const client = evaluate('utils/preferenceClient.ts', {
    'js-cookie': { get: () => undefined, remove: () => {} },
    '~/store/userStore': { useUserStore },
    '~/store/preferenceStore': { resetPreferences, usePreferenceStore },
    '~/store/settingStore': { useSettingStore },
    './kunFetch': {
      KunFetchError: LegacyFetchError,
      kunFetchGet: (url: string) => transport('GET', url),
      kunFetchPatch: (url: string, body: unknown) =>
        transport('PATCH', url, body)
    }
  })
  return client as typeof import('~/utils/preferenceClient')
}

beforeEach(() => {
  vi.resetAllMocks()
  resetPreferences()
  useUserStore.setState({
    sessionStatus: 'authenticated',
    sessionContext: context,
    sessionGeneration: 1,
    user: { ...useUserStore.getState().user, uid: 7 }
  })
  mocks.read.mockResolvedValue(complete())
  mocks.save.mockResolvedValue(complete(1))
})

describe('notification preference capability and released-client compatibility', () => {
  it.each(['nsfw', 'email-notice'] as const)(
    'lets the actual released client read and save %s without subscription changes',
    async (key) => {
      const client = loadLegacy()
      await client.refreshPreferences([19])
      expect(usePreferenceStore.getState().status).toBe('ready')
      expect(
        usePreferenceStore.getState().applied?.items['blocked-tag:19']
      ).toEqual({ value: false, version: 0 })
      client.editPreference(key, key === 'nsfw' ? 'all' : false)
      const result = complete(1)
      result.items[key].value = key === 'nsfw' ? 'all' : false
      mocks.save.mockResolvedValueOnce(result)
      expect(await client.savePreferenceDrafts()).toBe(true)
      expect(usePreferenceStore.getState().drafts).toEqual({})
      expect(usePreferenceStore.getState().applied?.version).toBe(1)
      expect(Object.keys(usePreferenceStore.getState().applied!.items)).toEqual(
        ['nsfw', 'email-notice', 'blocked-tag:7', 'blocked-tag:19']
      )
      expect(mocks.save.mock.calls[0][3]).toEqual([
        { key, value: key === 'nsfw' ? 'all' : false, version: 0 }
      ])
    }
  )

  it('lets the released save handler retain a same-item conflict and explicitly rebase then save', async () => {
    const client = loadLegacy()
    await client.refreshPreferences()
    client.editPreference('nsfw', 'all')
    const conflicting = complete(3)
    conflicting.items.nsfw.value = 'nsfw'
    mocks.save.mockResolvedValueOnce({
      code: 'PREFERENCE_CONFLICT',
      message: 'synthetic conflict',
      conflicts: ['nsfw'],
      snapshot: conflicting
    })
    expect(await client.savePreferenceDrafts()).toBe(false)
    expect(usePreferenceStore.getState()).toMatchObject({
      conflicts: ['nsfw'],
      drafts: { nsfw: { value: 'all', version: 0 } },
      applied: { version: 3 }
    })
    expect(
      usePreferenceStore.getState().applied?.items['blocked-tag:19']
    ).toEqual({ value: false, version: 3 })
    client.confirmPreferenceConflicts()
    const saved = complete(4)
    saved.items.nsfw.value = 'all'
    mocks.save.mockResolvedValueOnce(saved)
    expect(await client.savePreferenceDrafts()).toBe(true)
    expect(mocks.save.mock.calls[1][3]).toEqual([
      { key: 'nsfw', value: 'all', version: 3 }
    ])
    expect(usePreferenceStore.getState().drafts).toEqual({})
  })

  it('returns complete subscription values and versions to negotiated reads, saves and conflicts', async () => {
    const url = '/user/preferences?schema=notifications-v1'
    expect(
      preferenceSnapshotSchema.parse(
        await (await GET(request('GET', url))).json()
      )
    ).toEqual(complete())
    const input = {
      uid: 7,
      context,
      changes: [{ key: 'notification:like', value: true, version: 0 }]
    }
    expect((await PATCH(request('PATCH', url, input))).status).toBe(200)
    const conflict = {
      code: 'PREFERENCE_CONFLICT',
      message: 'synthetic conflict',
      conflicts: ['notification:like'],
      snapshot: complete(2)
    }
    mocks.save.mockResolvedValueOnce(conflict)
    const response = await PATCH(request('PATCH', url, input))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(conflict)
  })

  it.each([
    '?schema=future',
    '?schema=',
    '?schema=notifications-v1&schema=notifications-v1'
  ])(
    'rejects unknown or ambiguous capabilities %s before writing',
    async (query) => {
      const response = await PATCH(
        request('PATCH', '/user/preferences' + query, {
          uid: 7,
          context,
          changes: [{ key: 'nsfw', value: 'all', version: 0 }]
        })
      )
      expect(response.status).toBe(409)
      expect(mocks.save).not.toHaveBeenCalled()
      expect(
        (await GET(request('GET', '/user/preferences' + query))).status
      ).toBe(409)
      expect(mocks.read).not.toHaveBeenCalled()
    }
  )

  it('rejects mixed unnegotiated subscription writes and old-account drafts with zero writes', async () => {
    const input = {
      uid: 7,
      context,
      changes: [
        { key: 'email-notice', value: false, version: 0 },
        { key: 'notification:like', value: false, version: 0 }
      ]
    }
    expect(
      (await PATCH(request('PATCH', '/user/preferences', input))).status
    ).toBe(409)
    expect(
      (
        await PATCH(
          request('PATCH', '/user/preferences?schema=notifications-v1', {
            ...input,
            uid: 8
          })
        )
      ).status
    ).toBe(409)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
