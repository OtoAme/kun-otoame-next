import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginUnreadRead,
  bindUnreadSync,
  seedSessionUnread,
  createMessageSyncScheduler,
  isUnreadSummary
} from '~/utils/messageSync'
import { KunFetchError } from '~/utils/kunFetch'

const identity = { context: 'session-a', generation: 1 }
const unread = { hasUnreadMessages: true, hasUnreadChat: true }
const setup = (request = vi.fn().mockResolvedValue(unread)) => {
  const accept = vi.fn()
  const invalid = vi.fn()
  const sync = createMessageSyncScheduler({
    request,
    onSuccess: accept,
    onInvalid: invalid,
    validate: isUnreadSummary,
    random: () => 0.5
  })
  sync.setIdentity(identity)
  return { sync, read: request, accept, invalid }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('message sync scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())
  it('makes at most twelve reads in ten active minutes including initialization', async () => {
    const { sync, read } = setup()
    sync.setEnabled(true)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(read).toHaveBeenCalledTimes(11)
    sync.dispose()
  })

  it('reuses a valid session summary and rejects null or malformed seeds', async () => {
    const { sync, read } = setup()
    expect(sync.seed(null)).toBe(false)
    expect(sync.seed({ hasUnreadMessages: false })).toBe(false)
    expect(sync.getSnapshot().lastSuccessAt).toBeNull()
    expect(sync.seed(unread)).toBe(true)
    sync.setEnabled(true)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(read).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(1)
    sync.dispose()
  })

  it('deduplicates slow reads and ignores an older read after a session seed', async () => {
    let resolve!: (value: typeof unread) => void
    const read = vi.fn(
      () =>
        new Promise<typeof unread>((done) => {
          resolve = done
        })
    )
    const { sync, accept } = setup(read)
    sync.setEnabled(true)
    await flush()
    sync.refresh('resume')
    sync.refresh('manual')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(read).toHaveBeenCalledTimes(1)
    sync.seed({ hasUnreadMessages: false, hasUnreadChat: false })
    resolve(unread)
    await flush()
    expect(accept).toHaveBeenCalledTimes(1)
    expect(accept).toHaveBeenLastCalledWith({
      hasUnreadMessages: false,
      hasUnreadChat: false
    })
    sync.dispose()
  })

  it('preserves failures and respects Retry-After across lifecycle event storms', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new KunFetchError('rate', 'http', 429, 90_000))
      .mockResolvedValue(unread)
    const { sync } = setup(read)
    sync.seed(unread)
    sync.setEnabled(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sync.getSnapshot().lastSuccessAt).toBe(0)
    for (let count = 0; count < 20; count++) {
      sync.setEnabled(false)
      sync.setEnabled(true)
      sync.refresh('resume')
    }
    await vi.advanceTimersByTimeAsync(89_999)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    sync.dispose()
  })

  it('uses 60/120/240/300 second backoff, then recovers on success', async () => {
    const read = vi
      .fn()
      .mockRejectedValue(new KunFetchError('offline', 'network'))
    const { sync } = setup(read)
    sync.setEnabled(true)
    await flush()
    for (const delay of [60_000, 120_000, 240_000, 300_000]) {
      const count = read.mock.calls.length
      sync.refresh('resume')
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(read).toHaveBeenCalledTimes(count)
      await vi.advanceTimersByTimeAsync(1)
      expect(read).toHaveBeenCalledTimes(count + 1)
    }
    read.mockResolvedValue(unread)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sync.getSnapshot().status).toBe('synced')
    sync.dispose()
  })

  it('pauses and merges recovery within five seconds', async () => {
    const { sync, read } = setup()
    sync.setEnabled(true)
    await flush()
    sync.setEnabled(false)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(read).toHaveBeenCalledTimes(1)
    sync.setEnabled(true)
    sync.refresh('resume')
    sync.refresh('resume')
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    sync.refresh('resume')
    sync.refresh('resume')
    await vi.advanceTimersByTimeAsync(4_999)
    expect(read).toHaveBeenCalledTimes(2)
    sync.dispose()
  })

  it.each(['success', 'error'])(
    'isolates late %s on same-account new sessions',
    async (outcome) => {
      let resolve!: (value: typeof unread) => void
      let reject!: (error: unknown) => void
      const read = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((done, fail) => {
              resolve = done
              reject = fail
            })
        )
        .mockResolvedValue(unread)
      const { sync, accept, invalid } = setup(read)
      sync.setEnabled(true)
      await flush()
      sync.setIdentity({ context: 'session-b', generation: 2 })
      sync.seed({ hasUnreadMessages: false, hasUnreadChat: false })
      if (outcome === 'success') resolve(unread)
      else reject(new KunFetchError('old unauthorized', 'http', 401))
      await flush()
      expect(accept).toHaveBeenCalledTimes(1)
      expect(invalid).not.toHaveBeenCalled()
      expect(sync.getSnapshot().status).toBe('synced')
      sync.dispose()
    }
  )

  it('stops on current-session 401 without replacing the last summary', async () => {
    const { sync, invalid, accept } = setup(
      vi.fn().mockRejectedValue(new KunFetchError('invalid', 'http', 401))
    )
    sync.setEnabled(true)
    await flush()
    expect(invalid).toHaveBeenCalledTimes(1)
    expect(accept).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sync.getSnapshot().status).toBe('invalid')
    sync.dispose()
  })

  it('does not treat caller cancellation as a service failure', async () => {
    const { sync } = setup(
      vi.fn().mockRejectedValue(new KunFetchError('cancel', 'aborted'))
    )
    sync.setEnabled(true)
    await flush()
    expect(sync.getSnapshot().failures).toBe(0)
    sync.dispose()
  })

  it('validates the actual summary shape, including a legitimate zero', () => {
    expect(isUnreadSummary('business error')).toBe(false)
    expect(
      isUnreadSummary({ hasUnreadMessages: 0, hasUnreadChat: false })
    ).toBe(false)
    expect(
      isUnreadSummary({ hasUnreadMessages: false, hasUnreadChat: false })
    ).toBe(true)
  })
  it('does not accept legacy HTTP 200 business errors as a summary', async () => {
    const { sync, accept } = setup(vi.fn().mockResolvedValue('not logged in'))
    sync.setEnabled(true)
    await flush()
    expect(accept).not.toHaveBeenCalled()
    expect(sync.getSnapshot()).toMatchObject({
      status: 'error',
      failures: 1,
      lastSuccessAt: null
    })
    sync.dispose()
  })

  it('keeps an existing retry deadline when a valid session summary arrives', async () => {
    const { sync, read } = setup(
      vi.fn().mockRejectedValue(new KunFetchError('rate', 'http', 429, 180_000))
    )
    sync.setEnabled(true)
    await flush()
    sync.seed(unread)
    sync.refresh('resume')
    await vi.advanceTimersByTimeAsync(179_999)
    expect(read).toHaveBeenCalledTimes(1)
    sync.dispose()
  })

  it.each([
    { context: 'session-a', generation: 2 },
    { context: 'session-b', generation: 1 }
  ])(
    'checks both context and generation before accepting results',
    async (nextIdentity) => {
      let resolve!: (value: typeof unread) => void
      const { sync, accept } = setup(
        vi.fn(
          () =>
            new Promise<typeof unread>((done) => {
              resolve = done
            })
        )
      )
      sync.setEnabled(true)
      await flush()
      sync.setEnabled(false)
      sync.setIdentity(nextIdentity)
      resolve(unread)
      await flush()
      expect(accept).not.toHaveBeenCalled()
      expect(sync.getSnapshot().lastSuccessAt).toBeNull()
      sync.dispose()
    }
  )

  it.each([0, 1])(
    'bounds ten minute traffic at jitter endpoint %s',
    async (random) => {
      const read = vi.fn().mockResolvedValue(unread)
      const sync = createMessageSyncScheduler({
        request: read,
        onSuccess: vi.fn(),
        validate: isUnreadSummary,
        random: () => random
      })
      sync.setIdentity(identity)
      sync.setEnabled(true)
      await vi.advanceTimersByTimeAsync(600_000)
      expect(read.mock.calls.length).toBeLessThanOrEqual(12)
      expect(read.mock.calls.length).toBeGreaterThanOrEqual(10)
      sync.dispose()
    }
  )
  it('rejects old timestamps and a session read started before a newer summary', async () => {
    const { sync, accept } = setup()
    const oldRead = beginUnreadRead()
    sync.setEnabled(true)
    await flush()
    expect(sync.seed(unread, 1, oldRead)).toBe(false)
    await vi.advanceTimersByTimeAsync(10)
    expect(sync.seed(unread, -1)).toBe(false)
    expect(accept).toHaveBeenCalledTimes(1)
    sync.dispose()
  })

  it('does not replay a consumed seed on rebinding the same scheduler', async () => {
    const { sync, accept } = setup()
    const seedIdentity = { context: 'seed-rebinding', generation: 42 }
    seedSessionUnread(seedIdentity, {
      hasUnreadNotification: true,
      hasUnreadConversation: true
    })
    const unbind = bindUnreadSync(seedIdentity, sync)
    sync.setEnabled(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(accept).toHaveBeenCalledTimes(2)
    const successAt = sync.getSnapshot().lastSuccessAt
    unbind()
    bindUnreadSync(seedIdentity, sync)()
    expect(accept).toHaveBeenCalledTimes(2)
    expect(sync.getSnapshot().lastSuccessAt).toBe(successAt)
    sync.dispose()
  })

  it('discards a late session response instead of aborting a newer in-flight summary', async () => {
    let resolve!: (value: typeof unread) => void
    const seedIdentity = { context: 'late-session', generation: 43 }
    const oldSessionRead = beginUnreadRead()
    const { sync, accept } = setup(
      vi.fn(
        () =>
          new Promise<typeof unread>((done) => {
            resolve = done
          })
      )
    )
    const unbind = bindUnreadSync(seedIdentity, sync)
    sync.setEnabled(true)
    await flush()
    expect(
      seedSessionUnread(
        seedIdentity,
        { hasUnreadNotification: false, hasUnreadConversation: false },
        oldSessionRead
      )
    ).toBe(false)
    resolve(unread)
    await flush()
    expect(accept).toHaveBeenCalledTimes(1)
    expect(accept).toHaveBeenLastCalledWith(unread)
    unbind()
    sync.dispose()
  })
})
