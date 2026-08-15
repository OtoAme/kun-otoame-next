import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  sticker_pack: {
    findUnique: vi.fn(),
    findMany: vi.fn()
  },
  sticker: { findMany: vi.fn() },
  $transaction: vi.fn(),
  _tx: {
    sticker_pack: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    sticker: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn()
    },
    admin_log: { create: vi.fn() }
  }
}))

const s3Mock = vi.hoisted(() => ({
  deleteFileFromS3: vi.fn(),
  getS3PublicUrl: vi.fn((key: string | null | undefined) =>
    key ? `https://cdn.example/${key}` : null
  ),
  uploadBufferToS3: vi.fn()
}))

const stickerAssetsMock = vi.hoisted(() => ({
  STICKER_CACHE_CONTROL: 'immutable',
  STICKER_MAX_IMPORT_BYTES: 64 * 1024 * 1024,
  STICKER_MAX_IMPORT_ITEMS: 200,
  buildStickerId: vi.fn(() => 'cute_cats_happy_aaaaaaaaaaaaaaaaaa'),
  getStickerAssetKey: vi.fn(
    (slug: string, id: string, extension: string) =>
      `sticker/${slug}/${id}/asset.${extension}`
  ),
  getStickerPosterKey: vi.fn(
    (slug: string, id: string) => `sticker/${slug}/${id}/poster.webp`
  ),
  parseStickerAsset: vi.fn(),
  extractStickerZip: vi.fn()
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMock }))
vi.mock('~/lib/s3', () => s3Mock)
vi.mock('~/lib/stickerAssets', () => stickerAssetsMock)

describe('admin Sticker service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1007,
      name: 'Saya',
      role: 3
    })
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(prismaMock._tx)
    )
  })

  it('does not allow an empty Pack to be activated', async () => {
    prismaMock.sticker_pack.findUnique.mockResolvedValue({
      id: 4,
      slug: 'cute_cats',
      name: 'Cute Cats',
      description: '',
      status: 0,
      cover_url: null,
      cover_storage_key: null,
      cover_sticker_id: null
    })
    prismaMock._tx.sticker.findMany.mockResolvedValue([])

    const { updateStickerPack } = await import(
      '~/app/api/admin/stickers/service'
    )
    await expect(
      updateStickerPack(
        {
          packId: 4,
          name: 'Cute Cats',
          description: '',
          status: 1,
          coverStickerId: null
        },
        1007
      )
    ).resolves.toBe('Pack 至少需要一张有效 Sticker 才能启用')
    expect(prismaMock._tx.sticker_pack.update).not.toHaveBeenCalled()
  })

  it('keeps an active Pack from losing its only valid cover', async () => {
    prismaMock._tx.sticker.findUnique.mockResolvedValue({
      id: 'cute_cats_happy',
      status: 1,
      pack_id: 4,
      storage_key: 'sticker/cute_cats/happy.webp',
      thumbnail_storage_key: null,
      mime: 'image/webp',
      media_type: 'image',
      width: 512,
      height: 512,
      size: 12,
      pack: {
        name: 'Cute Cats',
        slug: 'cute_cats',
        status: 1,
        cover_sticker_id: 'cute_cats_happy'
      }
    })
    prismaMock._tx.sticker.findMany.mockResolvedValue([])

    const { updateStickerStatus } = await import(
      '~/app/api/admin/stickers/service'
    )
    await expect(
      updateStickerStatus({ stickerId: 'cute_cats_happy', status: 0 }, 1007)
    ).resolves.toBe('该 Sticker 是当前启用 Pack 的唯一有效封面，不能禁用')
    expect(prismaMock._tx.sticker.update).not.toHaveBeenCalled()
  })

  it('deletes uploaded objects when the database transaction fails', async () => {
    const asset = Buffer.from('valid-webp')
    stickerAssetsMock.parseStickerAsset.mockResolvedValue({
      mediaType: 'image',
      mime: 'image/webp',
      width: 32,
      height: 32,
      size: asset.byteLength,
      durationMs: null,
      frameRate: null,
      asset,
      poster: null,
      extension: 'webp',
      contentHash: 'a'.repeat(64)
    })
    prismaMock.sticker_pack.findUnique.mockResolvedValue({
      id: 4,
      slug: 'cute_cats',
      name: 'Cute Cats',
      status: 0
    })
    prismaMock.sticker.findMany.mockResolvedValue([])
    prismaMock._tx.sticker_pack.findUnique.mockResolvedValue({
      id: 4,
      slug: 'cute_cats',
      name: 'Cute Cats',
      description: '',
      status: 0,
      cover_sticker_id: null
    })
    prismaMock._tx.sticker.aggregate.mockResolvedValue({
      _max: { sort_order: null }
    })
    prismaMock._tx.sticker.create.mockRejectedValue(new Error('db failed'))

    const { importStickerAssets } = await import(
      '~/app/api/admin/stickers/service'
    )
    await expect(
      importStickerAssets({
        packId: 4,
        files: [{ name: 'happy.webp', buffer: asset }],
        uid: 1007
      })
    ).resolves.toBe('Sticker 导入失败，已回滚数据库记录，请稍后重试')
    expect(s3Mock.uploadBufferToS3).toHaveBeenCalledWith(
      'sticker/cute_cats/cute_cats_happy_aaaaaaaaaaaaaaaaaa/asset.webp',
      asset,
      'image/webp',
      'immutable'
    )
    expect(s3Mock.deleteFileFromS3).toHaveBeenCalledWith(
      'sticker/cute_cats/cute_cats_happy_aaaaaaaaaaaaaaaaaa/asset.webp'
    )
  })

  it('updates multiple Sticker statuses in one transaction', async () => {
    prismaMock._tx.sticker.findMany.mockResolvedValue([
      {
        id: 'cute_cats_happy',
        status: 1,
        pack_id: 4,
        storage_key: 'sticker/cute_cats/happy/asset.webp',
        thumbnail_storage_key: null,
        media_type: 'image',
        width: 512,
        height: 512,
        size: 1024,
        pack: {
          name: 'Cute Cats',
          slug: 'cute_cats',
          status: 0,
          cover_sticker_id: 'cute_cats_happy'
        }
      },
      {
        id: 'cute_cats_wave',
        status: 1,
        pack_id: 4,
        storage_key: 'sticker/cute_cats/wave/asset.webm',
        thumbnail_storage_key: 'sticker/cute_cats/wave/poster.webp',
        media_type: 'video',
        width: 512,
        height: 512,
        size: 2048,
        pack: {
          name: 'Cute Cats',
          slug: 'cute_cats',
          status: 0,
          cover_sticker_id: 'cute_cats_happy'
        }
      }
    ])
    prismaMock.sticker_pack.findMany.mockResolvedValue([
      {
        id: 4,
        slug: 'cute_cats',
        name: 'Cute Cats',
        description: '',
        cover_url: null,
        cover_storage_key: null,
        cover_sticker_id: 'cute_cats_happy',
        price: 0,
        status: 0,
        is_builtin: true,
        stickers: [],
        cover_sticker: null
      }
    ])

    const { updateStickerStatuses } = await import(
      '~/app/api/admin/stickers/service'
    )
    const response = await updateStickerStatuses(
      {
        stickerIds: ['cute_cats_happy', 'cute_cats_wave'],
        status: 0
      },
      1007
    )

    expect(response).toMatchObject({ id: 4 })
    expect(prismaMock._tx.sticker.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['cute_cats_happy', 'cute_cats_wave'] },
        pack_id: 4
      },
      data: { status: 0 }
    })
  })

  it('permanently deletes unreferenced Stickers and their S3 objects', async () => {
    prismaMock._tx.sticker.findMany.mockResolvedValue([
      {
        id: 'cute_cats_wave',
        pack_id: 4,
        storage_key: 'sticker/cute_cats/wave/asset.webm',
        thumbnail_storage_key: 'sticker/cute_cats/wave/poster.webp',
        pack: {
          name: 'Cute Cats',
          slug: 'cute_cats',
          status: 0,
          cover_sticker_id: 'cute_cats_happy'
        },
        _count: { messages: 0, reply_messages: 0 }
      }
    ])
    prismaMock.sticker_pack.findMany.mockResolvedValue([
      {
        id: 4,
        slug: 'cute_cats',
        name: 'Cute Cats',
        description: '',
        cover_url: null,
        cover_storage_key: null,
        cover_sticker_id: 'cute_cats_happy',
        price: 0,
        status: 0,
        is_builtin: true,
        stickers: [],
        cover_sticker: null
      }
    ])

    const { deleteStickers } = await import('~/app/api/admin/stickers/service')
    const response = await deleteStickers(
      { stickerIds: ['cute_cats_wave'] },
      1007
    )

    expect(response).toMatchObject({
      deletedCount: 1,
      objectCleanupFailed: 0,
      pack: { id: 4 }
    })
    expect(prismaMock._tx.sticker.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['cute_cats_wave'] }, pack_id: 4 }
    })
    expect(s3Mock.deleteFileFromS3).toHaveBeenCalledWith(
      'sticker/cute_cats/wave/asset.webm'
    )
    expect(s3Mock.deleteFileFromS3).toHaveBeenCalledWith(
      'sticker/cute_cats/wave/poster.webp'
    )
  })

  it('keeps historically referenced Stickers and their objects', async () => {
    prismaMock._tx.sticker.findMany.mockResolvedValue([
      {
        id: 'cute_cats_wave',
        pack_id: 4,
        storage_key: 'sticker/cute_cats/wave/asset.webm',
        thumbnail_storage_key: 'sticker/cute_cats/wave/poster.webp',
        pack: {
          name: 'Cute Cats',
          slug: 'cute_cats',
          status: 0,
          cover_sticker_id: null
        },
        _count: { messages: 1, reply_messages: 0 }
      }
    ])

    const { deleteStickers } = await import('~/app/api/admin/stickers/service')
    await expect(
      deleteStickers({ stickerIds: ['cute_cats_wave'] }, 1007)
    ).resolves.toContain('已被历史消息引用')
    expect(prismaMock._tx.sticker.deleteMany).not.toHaveBeenCalled()
    expect(s3Mock.deleteFileFromS3).not.toHaveBeenCalled()
  })

  it('deletes an offline unowned Pack and all of its S3 objects', async () => {
    prismaMock._tx.sticker_pack.findUnique.mockResolvedValue({
      id: 4,
      slug: 'cute_cats',
      name: 'Cute Cats',
      status: 0,
      cover_storage_key: 'sticker/cute_cats/cover.webp',
      ownerships: [],
      stickers: [
        {
          id: 'cute_cats_wave',
          storage_key: 'sticker/cute_cats/wave/asset.webm',
          thumbnail_storage_key: 'sticker/cute_cats/wave/poster.webp',
          _count: { messages: 0, reply_messages: 0 }
        }
      ]
    })

    const { deleteStickerPack } = await import(
      '~/app/api/admin/stickers/service'
    )
    const response = await deleteStickerPack({ packId: 4 }, 1007)

    expect(response).toEqual({
      packId: 4,
      deletedStickerCount: 1,
      objectCleanupFailed: 0
    })
    expect(prismaMock._tx.sticker_pack.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { cover_sticker_id: null }
    })
    expect(prismaMock._tx.sticker.deleteMany).toHaveBeenCalledWith({
      where: { pack_id: 4 }
    })
    expect(prismaMock._tx.sticker_pack.delete).toHaveBeenCalledWith({
      where: { id: 4 }
    })
    expect(s3Mock.deleteFileFromS3).toHaveBeenCalledTimes(3)
  })

  it('keeps a Pack that already has user ownership records', async () => {
    prismaMock._tx.sticker_pack.findUnique.mockResolvedValue({
      id: 4,
      slug: 'cute_cats',
      name: 'Cute Cats',
      status: 0,
      cover_storage_key: null,
      ownerships: [{ id: 12 }],
      stickers: []
    })

    const { deleteStickerPack } = await import(
      '~/app/api/admin/stickers/service'
    )
    await expect(deleteStickerPack({ packId: 4 }, 1007)).resolves.toContain(
      '用户所有权记录'
    )
    expect(prismaMock._tx.sticker_pack.delete).not.toHaveBeenCalled()
    expect(s3Mock.deleteFileFromS3).not.toHaveBeenCalled()
  })
})
