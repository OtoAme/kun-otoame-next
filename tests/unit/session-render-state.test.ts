import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  preferences: vi.fn(),
  context: vi.fn(),
  rethrow: vi.fn()
}))
vi.mock('~/utils/actions/getSessionIdentity', () => ({
  getPageIdentity: mocks.identity
}))
vi.mock('~/utils/actions/getBrowsingPreferences', () => ({
  getPageBrowsingPreferences: mocks.preferences
}))
vi.mock('~/app/api/utils/sessionIdentity', () => ({
  getSessionContext: mocks.context
}))
vi.mock('next/navigation', () => ({ unstable_rethrow: mocks.rethrow }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.identity.mockResolvedValue(null)
  mocks.preferences.mockResolvedValue({ mode: 'sfw', blockedTagIds: [] })
  mocks.context.mockReturnValue('verified-session')
})

describe('server rendering identity', () => {
  it('records the confirmed anonymous browsing scope', async () => {
    const { getSessionRenderState } = await import(
      '~/utils/actions/getSessionRenderState'
    )
    expect(await getSessionRenderState()).toEqual({
      identity: 'guest',
      browsingKey: '["sfw",[]]'
    })
  })

  it('records authenticated identity and effective browsing conditions without user credentials', async () => {
    mocks.identity.mockResolvedValue({ uid: 7 })
    mocks.preferences.mockResolvedValue({ mode: 'all', blockedTagIds: [9, 3] })
    const { getSessionRenderState } = await import(
      '~/utils/actions/getSessionRenderState'
    )
    expect(await getSessionRenderState()).toEqual({
      identity: 'verified-session',
      browsingKey: '["all",[3,9]]'
    })
  })

  it('keeps an unavailable identity unconfirmed', async () => {
    mocks.identity.mockRejectedValue(
      new Error('synthetic authentication outage')
    )
    const { getSessionRenderState } = await import(
      '~/utils/actions/getSessionRenderState'
    )
    expect(await getSessionRenderState()).toBeNull()
    expect(mocks.preferences).not.toHaveBeenCalled()
  })

  it('preserves confirmed identity when preference reading fails', async () => {
    mocks.identity.mockResolvedValue({ uid: 7 })
    mocks.preferences.mockRejectedValue(
      new Error('synthetic preference outage')
    )
    const { getSessionRenderState } = await import(
      '~/utils/actions/getSessionRenderState'
    )
    expect(await getSessionRenderState()).toEqual({
      identity: 'verified-session',
      browsingKey: null
    })
  })

  it('lets Next handle framework rendering errors', async () => {
    const error = new Error('framework control flow')
    mocks.identity.mockRejectedValue(error)
    mocks.rethrow.mockImplementation((received) => {
      throw received
    })
    const { getSessionRenderState } = await import(
      '~/utils/actions/getSessionRenderState'
    )
    await expect(getSessionRenderState()).rejects.toBe(error)
  })
})
