import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  database: {}
}))
vi.mock('~/prisma', () => ({ prisma: mocks.database }))
vi.mock('~/app/api/utils/sessionIdentity', () => ({
  getRequestIdentity: mocks.identity,
  requireAvailableIdentity: (identity: {
    status: string
    payload?: unknown
  }) => {
    if (identity.status === 'unavailable') throw new Error('unavailable')
    return identity.status === 'authenticated' ? identity.payload : null
  },
  getSessionContext: () => 'a'.repeat(64)
}))
vi.mock('~/lib/accountPreferences/service', () => ({
  readPreferenceSnapshot: mocks.read,
  saveAccountPreferences: mocks.save,
  PreferenceError: class extends Error {}
}))
import { GET, PATCH } from '~/app/api/user/preferences/route'
import { POST as legacyEmail } from '~/app/api/auth/email-notice/route'
import { POST as currentEmail } from '~/app/api/user/setting/email-notice/route'

const snapshot = {
  uid: 1,
  context: 'a'.repeat(64),
  version: 7,
  nsfwSelected: true,
  blockedTagIds: [],
  items: {
    nsfw: { value: 'all', version: 2 },
    'email-notice': { value: false, version: 0 }
  }
}
const body = {
  uid: 1,
  context: 'a'.repeat(64),
  changes: [{ key: 'nsfw', value: 'sfw', version: 2 }]
}
const request = (data: unknown, query = '') =>
  new NextRequest(`http://localhost/api/user/preferences${query}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' }
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.identity.mockResolvedValue({
    status: 'authenticated',
    payload: { uid: 1 }
  })
  mocks.read.mockResolvedValue(snapshot)
  mocks.save.mockResolvedValue(snapshot)
})
describe('account preference boundaries', () => {
  it.each([{ uid: 2 }, { context: 'b'.repeat(64) }])(
    'rejects a draft from another account or session without reading or writing',
    async (different) => {
      const response = await PATCH(request({ ...body, ...different }))
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        code: 'PREFERENCE_CONTEXT_CHANGED',
        message: expect.any(String)
      })
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    }
  )
  it('writes only the authenticated account with the fixed draft versions', async () => {
    const response = await PATCH(request(body))
    expect(response.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith(
      mocks.database,
      1,
      body.context,
      body.changes
    )
  })
  it('returns an atomic conflict and the current authenticated snapshot', async () => {
    const conflict = {
      code: 'PREFERENCE_CONFLICT',
      conflicts: ['nsfw'],
      snapshot
    }
    mocks.save.mockResolvedValue(conflict)
    const response = await PATCH(request(body))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(conflict)
  })
  it.each(['guest', 'unavailable'])(
    'does no preference work for %s identity',
    async (status) => {
      mocks.identity.mockResolvedValue({ status })
      const response = await PATCH(request(body))
      expect(response.status).toBe(status === 'guest' ? 401 : 503)
      expect(mocks.save).not.toHaveBeenCalled()
    }
  )
  it.each([
    {
      ...body,
      changes: [{ key: 'required-notification', value: false, version: 0 }]
    },
    { ...body, changes: [{ key: 'nsfw', value: true, version: 0 }] },
    { ...body, changes: [{ key: 'blocked-tag:0', value: true, version: 0 }] },
    { ...body, changes: [body.changes[0], body.changes[0]] },
    {
      ...body,
      changes: [{ key: 'nsfw', value: 'sfw', version: Number.MAX_SAFE_INTEGER }]
    }
  ])(
    'rejects unknown, malformed or duplicated logical items',
    async (invalid) => {
      expect((await PATCH(request(invalid))).status).toBe(400)
      expect(mocks.save).not.toHaveBeenCalled()
    }
  )
  it('bounds candidate reads and preserves their current tombstone versions', async () => {
    expect((await GET(request(null, '?tagId=19'))).status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith(mocks.database, 1, body.context, [
      'blocked-tag:19'
    ])
    expect((await GET(request(null, '?tagId=0'))).status).toBe(400)
    expect(
      (await GET(request(null, '?' + Array(101).fill('tagId=19').join('&'))))
        .status
    ).toBe(400)
  })
  it.each([legacyEmail, currentEmail])(
    'requires explicit versions at both email entry points',
    async (save) => {
      expect((await save(request({}))).status).toBe(400)
      expect((await save(request(body))).status).toBe(400)
      const mail = {
        ...body,
        changes: [{ key: 'email-notice', value: false, version: 2 }]
      }
      expect((await save(request(mail))).status).toBe(200)
    }
  )
})
