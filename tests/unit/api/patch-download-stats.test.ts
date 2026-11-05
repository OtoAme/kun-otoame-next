import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  patch: { update: vi.fn(), updateMany: vi.fn() },
  patch_resource: { update: vi.fn(), updateMany: vi.fn() },
  patch_resource_link: { update: vi.fn(), updateMany: vi.fn() }
}))

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

const statementsOf = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.map((call) => (call[0] as string[]).join(' ?'))

const input = { patchId: 99, resourceId: 10, linkId: 30 }

describe('patch resource download stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.$executeRaw.mockResolvedValue(1)
  })

  it('counts only the link click and leaves public download totals alone', async () => {
    const result = await downloadStats(input)

    expect(result).toEqual({})
    expect(prismaMocks.patch.update).not.toHaveBeenCalled()
    expect(prismaMocks.patch.updateMany).not.toHaveBeenCalled()
    expect(prismaMocks.patch_resource.update).not.toHaveBeenCalled()
    expect(prismaMocks.patch_resource.updateMany).not.toHaveBeenCalled()
    expect(prismaMocks.patch_resource_link.update).not.toHaveBeenCalled()
    expect(prismaMocks.patch_resource_link.updateMany).not.toHaveBeenCalled()
    expect(prismaMocks.$queryRaw).not.toHaveBeenCalled()

    const executed = statementsOf(prismaMocks.$executeRaw)
    expect(executed).toHaveLength(1)
    expect(executed[0]).toContain('UPDATE patch_resource_link')
    expect(executed[0]).toContain('click = click + 1')
    expect(executed[0]).not.toContain('download = download + 1')
    expect(executed[0]).not.toContain('updated')
    expect(prismaMocks.$executeRaw.mock.calls[0].slice(1)).toEqual([
      input.linkId,
      input.resourceId,
      input.patchId
    ])
    expect(bufferMocks.setRealtimePatchDownloadStats).not.toHaveBeenCalled()
    expect(cacheMocks.invalidatePatchContentCache).not.toHaveBeenCalled()
    expect(cacheMocks.invalidatePatchListCaches).not.toHaveBeenCalled()
  })

  it('rejects an unmatched link without a public cache refresh', async () => {
    prismaMocks.$executeRaw.mockResolvedValueOnce(0)

    const result = await downloadStats(input)

    expect(result).toBe('未找到对应资源链接')
    expect(prismaMocks.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prismaMocks.$queryRaw).not.toHaveBeenCalled()
    expect(bufferMocks.setRealtimePatchDownloadStats).not.toHaveBeenCalled()
    expect(cacheMocks.invalidatePatchContentCache).not.toHaveBeenCalled()
    expect(cacheMocks.invalidatePatchListCaches).not.toHaveBeenCalled()
  })
})
