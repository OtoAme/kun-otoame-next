import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    patch: { update: vi.fn(), updateMany: vi.fn() },
    patch_resource: { update: vi.fn(), updateMany: vi.fn() },
    patch_resource_link: { update: vi.fn(), updateMany: vi.fn() }
  }

  return {
    $transaction: vi.fn((fn: (txClient: typeof tx) => Promise<unknown>) =>
      fn(tx)
    ),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

const cacheMocks = vi.hoisted(() => ({
  invalidatePatchContentCache: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))

vi.mock('~/app/api/patch/cache', () => cacheMocks)

const bufferMocks = vi.hoisted(() => ({
  setRealtimePatchDownloadStats: vi.fn()
}))

vi.mock('~/app/api/patch/views/buffer', () => bufferMocks)

import { downloadStats } from '~/app/api/patch/resource/download/service'

const tx = prismaMocks._tx

const statementsOf = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.map((call) => (call[0] as string[]).join(' ?'))

const input = { patchId: 99, resourceId: 10, linkId: 30 }

describe('patch resource download stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.$executeRaw.mockResolvedValue(1)
    tx.$queryRaw.mockResolvedValue([{ unique_id: 'abc12345', download: 7 }])
  })

  it('increments counters without touching the updated timestamp', async () => {
    const result = await downloadStats(input)

    expect(result).toEqual({})

    // Prisma 的 @updatedAt 会在任何 delegate update 上刷新 updated,
    // 所以纯计数路径必须完全走原生 SQL
    expect(tx.patch.update).not.toHaveBeenCalled()
    expect(tx.patch.updateMany).not.toHaveBeenCalled()
    expect(tx.patch_resource.updateMany).not.toHaveBeenCalled()
    expect(tx.patch_resource_link.updateMany).not.toHaveBeenCalled()

    const executed = statementsOf(tx.$executeRaw)
    const queried = statementsOf(tx.$queryRaw)

    expect(executed).toHaveLength(2)
    expect(queried).toHaveLength(1)
    for (const statement of [...executed, ...queried]) {
      expect(statement).not.toContain('updated')
    }

    expect(executed[0]).toContain('UPDATE patch_resource_link')
    expect(executed[0]).toContain('download = download + 1')
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([
      input.linkId,
      input.resourceId,
      input.patchId
    ])

    expect(executed[1]).toContain('UPDATE patch_resource')
    expect(executed[1]).toContain('download = download + 1')
    expect(tx.$executeRaw.mock.calls[1].slice(1)).toEqual([
      input.resourceId,
      input.patchId
    ])

    expect(queried[0]).toContain('UPDATE patch')
    expect(queried[0]).toContain('download = download + 1')
    expect(queried[0]).toContain('RETURNING unique_id, download')
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([input.patchId])
  })

  it('refreshes realtime stats and patch caches with the returned counter', async () => {
    await downloadStats(input)

    expect(bufferMocks.setRealtimePatchDownloadStats).toHaveBeenCalledWith(
      'abc12345',
      7
    )
    expect(cacheMocks.invalidatePatchContentCache).toHaveBeenCalledWith(
      'abc12345'
    )
    expect(cacheMocks.invalidatePatchListCaches).toHaveBeenCalledTimes(1)
  })

  it('rejects an unmatched link without incrementing the resource or patch', async () => {
    tx.$executeRaw.mockResolvedValueOnce(0)

    const result = await downloadStats(input)

    expect(result).toBe('未找到对应资源链接')
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(bufferMocks.setRealtimePatchDownloadStats).not.toHaveBeenCalled()
    expect(cacheMocks.invalidatePatchContentCache).not.toHaveBeenCalled()
    expect(cacheMocks.invalidatePatchListCaches).not.toHaveBeenCalled()
  })
})
