import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import type { patchCreateSchema } from '~/validations/edit'

const mocks = vi.hoisted(() => {
  const tx = {
    patch: {
      create: vi.fn(),
      update: vi.fn()
    },
    patch_rating_stat: {
      create: vi.fn()
    },
    patch_alias: {
      createMany: vi.fn()
    },
    user: {
      update: vi.fn()
    }
  }

  return {
    prisma: {
      patch: {
        findFirst: vi.fn()
      },
      $transaction: vi.fn((fn: (transaction: typeof tx) => Promise<unknown>) =>
        fn(tx)
      )
    },
    tx,
    uploadPatchBanner: vi.fn(),
    processSubmittedExternalData: vi.fn(),
    invalidatePatchListCaches: vi.fn(),
    postToIndexNow: vi.fn()
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: mocks.prisma
}))

vi.mock('~/app/api/edit/_upload', () => ({
  uploadPatchBanner: mocks.uploadPatchBanner
}))

vi.mock('~/app/api/edit/processExternalData', () => ({
  processSubmittedExternalData: mocks.processSubmittedExternalData
}))

vi.mock('~/app/api/patch/cache', () => ({
  invalidatePatchListCaches: mocks.invalidatePatchListCaches
}))

vi.mock('~/app/api/edit/_postToIndexNow', () => ({
  postToIndexNow: mocks.postToIndexNow
}))

import { createGalgame } from '~/app/api/edit/create'

type CreateInput = Omit<
  z.infer<typeof patchCreateSchema>,
  'alias' | 'tag' | 'banner' | 'bannerOriginal'
> & {
  alias: string[]
  tag: string[]
  banner: ArrayBuffer
  bannerOriginal?: ArrayBuffer
}

const makeInput = (): CreateInput => ({
  name: 'Test Otome',
  vndbId: '',
  vndbRelationId: '',
  bangumiId: '',
  steamId: '',
  dlsiteCode: '',
  dlsiteCircleName: '',
  dlsiteCircleLink: '',
  vndbTags: [],
  vndbDevelopers: [],
  bangumiTags: [],
  bangumiDevelopers: [],
  steamTags: [],
  steamDevelopers: [],
  steamAliases: [],
  alias: ['Alias'],
  tag: ['Tag'],
  banner: new ArrayBuffer(1),
  introduction: 'This introduction is long enough.',
  officialUrl: '',
  released: '2026-06-21',
  contentLimit: 'sfw',
  isDuplicate: 'false'
})

describe('createGalgame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.prisma.patch.findFirst.mockResolvedValue(null)
    mocks.prisma.$transaction.mockImplementation(
      (fn: (transaction: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx)
    )
    mocks.tx.patch.create.mockResolvedValue({ id: 42 })
    mocks.tx.patch.update.mockResolvedValue({})
    mocks.tx.patch_rating_stat.create.mockResolvedValue({})
    mocks.tx.patch_alias.createMany.mockResolvedValue({ count: 1 })
    mocks.tx.user.update.mockResolvedValue({})
    mocks.uploadPatchBanner.mockResolvedValue(undefined)
    mocks.processSubmittedExternalData.mockResolvedValue(undefined)
    mocks.invalidatePatchListCaches.mockResolvedValue(undefined)
    mocks.postToIndexNow.mockResolvedValue(undefined)
  })

  it('waits for external metadata before returning the created patch', async () => {
    const result = await createGalgame(makeInput(), 100)

    expect(result).toEqual({
      uniqueId: expect.stringMatching(/^[a-f0-9]{8}$/),
      patchId: 42
    })
    expect(mocks.processSubmittedExternalData).toHaveBeenCalledBefore(
      mocks.invalidatePatchListCaches
    )
    expect(mocks.invalidatePatchListCaches).toHaveBeenCalledBefore(
      mocks.postToIndexNow
    )
  })

  it('logs duplicate check query failures with the exact step name', async () => {
    const error = new Error('database closed connection')
    const input = makeInput()
    input.vndbId = 'v123'
    mocks.prisma.patch.findFirst.mockRejectedValue(error)

    await expect(createGalgame(input, 100)).rejects.toThrow(
      'database closed connection'
    )

    expect(console.error).toHaveBeenCalledWith(
      '[EditCreate] create failed at checkVndbDuplicate',
      expect.objectContaining({
        uid: 100,
        name: 'Test Otome',
        vndbId: 'v123',
        error
      })
    )
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('logs and propagates the failed publish step before returning success', async () => {
    const error = new Error('external metadata failed')
    mocks.processSubmittedExternalData.mockRejectedValue(error)

    await expect(createGalgame(makeInput(), 100)).rejects.toThrow(
      'external metadata failed'
    )

    expect(console.error).toHaveBeenCalledWith(
      '[EditCreate] create failed at processSubmittedExternalData',
      expect.objectContaining({
        patchId: 42,
        uid: 100,
        error
      })
    )
    expect(mocks.invalidatePatchListCaches).not.toHaveBeenCalled()
    expect(mocks.postToIndexNow).not.toHaveBeenCalled()
  })

  it('logs upload validation failures at the banner upload step', async () => {
    mocks.uploadPatchBanner.mockResolvedValue('图片体积过大')

    await expect(createGalgame(makeInput(), 100)).resolves.toBe('图片体积过大')

    expect(console.error).toHaveBeenCalledWith(
      '[EditCreate] create failed at uploadPatchBanner',
      expect.objectContaining({
        patchId: 42,
        uid: 100,
        reason: '图片体积过大'
      })
    )
    expect(mocks.processSubmittedExternalData).not.toHaveBeenCalled()
  })

  it('logs thrown transaction sub-step failures with the exact step name', async () => {
    const error = new Error('s3 closed connection')
    mocks.uploadPatchBanner.mockRejectedValue(error)

    await expect(createGalgame(makeInput(), 100)).rejects.toThrow(
      's3 closed connection'
    )

    expect(console.error).toHaveBeenCalledWith(
      '[EditCreate] create failed at uploadPatchBanner',
      expect.objectContaining({
        patchId: 42,
        uid: 100,
        error
      })
    )
    expect(console.error).not.toHaveBeenCalledWith(
      '[EditCreate] create failed at coreTransaction',
      expect.anything()
    )
  })
})
