import { describe, expect, it, vi } from 'vitest'
import { disconnectResolverWorkerResources } from '~/tests/e2e/company-identity.e2e'

describe('company identity E2E resolver worker cleanup', () => {
  it('disconnects both worker-owned Prisma and Redis handles', async () => {
    const prismaDisconnect = vi.fn(async () => undefined)
    const redisDisconnect = vi.fn()

    await disconnectResolverWorkerResources(prismaDisconnect, {
      disconnect: redisDisconnect
    })

    expect(prismaDisconnect).toHaveBeenCalledOnce()
    expect(redisDisconnect).toHaveBeenCalledOnce()
  })

  it('still disconnects Redis when Prisma disconnect rejects', async () => {
    const redisDisconnect = vi.fn()

    await expect(
      disconnectResolverWorkerResources(
        vi.fn(async () => {
          throw new Error('prisma disconnect failed')
        }),
        { disconnect: redisDisconnect }
      )
    ).rejects.toThrow('prisma disconnect failed')
    expect(redisDisconnect).toHaveBeenCalledOnce()
  })
})
