import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch_resource: {
    findMany: vi.fn(),
    count: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

import { getPatchResource } from '~/app/api/admin/resource/get'

describe('admin resource list service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch_resource.findMany.mockResolvedValue([])
    prismaMocks.patch_resource.count.mockResolvedValue(0)
  })

  it('searches resource links by content or BLAKE3 hash', async () => {
    await getPatchResource(
      {
        page: 1,
        limit: 30,
        search: 'abc-hash',
        userId: undefined
      },
      {}
    )

    expect(prismaMocks.patch_resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              links: {
                some: {
                  content: {
                    contains: 'abc-hash',
                    mode: 'insensitive'
                  }
                }
              }
            },
            {
              links: {
                some: {
                  hash: {
                    contains: 'abc-hash',
                    mode: 'insensitive'
                  }
                }
              }
            }
          ]
        })
      })
    )
    expect(prismaMocks.patch_resource.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.any(Array)
      })
    })
  })
})
