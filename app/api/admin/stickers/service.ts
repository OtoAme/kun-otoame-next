import path from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { deleteFileFromS3, getS3PublicUrl, uploadBufferToS3 } from '~/lib/s3'
import {
  buildStickerId,
  getStickerAssetKey,
  getStickerPosterKey,
  parseStickerAsset,
  extractStickerZip,
  STICKER_CACHE_CONTROL,
  STICKER_MAX_IMPORT_BYTES,
  STICKER_MAX_IMPORT_ITEMS,
  type ParsedStickerAsset,
  type StickerSourceFile
} from '~/lib/stickerAssets'
import {
  adminStickerBatchStatusSchema,
  adminStickerDeleteSchema,
  adminStickerPackDeleteSchema,
  adminStickerPackCreateSchema,
  adminStickerPackUpdateSchema,
  adminStickerStatusSchema
} from '~/validations/sticker'
import type {
  AdminSticker,
  AdminStickerDeleteResult,
  AdminStickerPack,
  AdminStickerPackDeleteResult
} from '~/types/api/admin'
import type { z } from 'zod'

export const STICKER_PACK_ACTIVE = 1
export const STICKER_ACTIVE = 1

const adminPackInclude = {
  stickers: {
    orderBy: [{ sort_order: 'asc' }, { created: 'asc' }]
  },
  cover_sticker: true
} satisfies Prisma.sticker_packInclude

type AdminPackRecord = Prisma.sticker_packGetPayload<{
  include: typeof adminPackInclude
}>

type ImportFailure = { name: string; reason: string }

const getAdmin = async (uid: number) => {
  const admin = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, name: true, role: true }
  })
  if (!admin) {
    return '未找到当前管理员'
  }
  if (admin.role < 3) {
    return '本页面仅管理员可访问'
  }
  return admin
}

const getStickerUrl = (legacyUrl: string | null, storageKey: string | null) =>
  legacyUrl || getS3PublicUrl(storageKey)

const mapSticker = (
  sticker: AdminPackRecord['stickers'][number]
): AdminSticker => {
  const assetUrl = getStickerUrl(sticker.asset_url, sticker.storage_key)
  const thumbnailUrl = getStickerUrl(
    sticker.thumbnail_url,
    sticker.thumbnail_storage_key
  )

  return {
    id: sticker.id,
    packId: sticker.pack_id,
    alt: sticker.alt,
    assetKey: sticker.storage_key,
    thumbnailKey: sticker.thumbnail_storage_key,
    assetUrl,
    thumbnailUrl:
      thumbnailUrl ?? (sticker.media_type === 'image' ? assetUrl : null),
    mime: sticker.mime,
    mediaType: sticker.media_type === 'video' ? 'video' : 'image',
    status: sticker.status,
    contentHash: sticker.content_hash,
    width: sticker.width,
    height: sticker.height,
    size: sticker.size,
    durationMs: sticker.duration_ms,
    frameRate: sticker.frame_rate,
    sortOrder: sticker.sort_order
  }
}

const mapPack = (pack: AdminPackRecord): AdminStickerPack => {
  const stickers = (pack.stickers ?? []).map(mapSticker)
  const coverSticker =
    pack.cover_sticker && hasValidSticker(pack.cover_sticker)
      ? mapSticker(pack.cover_sticker)
      : null

  return {
    id: pack.id,
    slug: pack.slug,
    name: pack.name,
    description: pack.description,
    status: pack.status,
    price: pack.price,
    isBuiltin: pack.is_builtin,
    coverStickerId: pack.cover_sticker_id,
    coverUrl:
      pack.cover_url ??
      getS3PublicUrl(pack.cover_storage_key) ??
      coverSticker?.thumbnailUrl ??
      stickers.find((sticker) => sticker.status === STICKER_ACTIVE)
        ?.thumbnailUrl ??
      null,
    stickers
  }
}

export const getAdminStickerPacks = async (packId?: number) => {
  const packs = await prisma.sticker_pack.findMany({
    where: packId ? { id: packId } : undefined,
    include: adminPackInclude,
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }]
  })

  return { packs: packs.map(mapPack) }
}

const hasValidSticker = (sticker: {
  status: number
  storage_key: string
  width: number
  height: number
  size: number
  media_type: string
  thumbnail_storage_key?: string | null
}) =>
  sticker.status === STICKER_ACTIVE &&
  sticker.storage_key.trim().length > 0 &&
  sticker.width > 0 &&
  sticker.height > 0 &&
  sticker.size > 0 &&
  (sticker.media_type !== 'video' || Boolean(sticker.thumbnail_storage_key))

const getValidCoverSticker = async (
  tx: Prisma.TransactionClient,
  packId: number,
  stickerId: string | null | undefined,
  excludedStickerIds: string[] = []
) => {
  if (stickerId) {
    const sticker = await tx.sticker.findFirst({
      where: { id: stickerId, pack_id: packId },
      select: {
        id: true,
        status: true,
        storage_key: true,
        width: true,
        height: true,
        size: true,
        media_type: true,
        thumbnail_storage_key: true
      }
    })
    return sticker &&
      !excludedStickerIds.includes(sticker.id) &&
      hasValidSticker(sticker)
      ? sticker
      : null
  }

  const stickers = await tx.sticker.findMany({
    where: {
      pack_id: packId,
      status: STICKER_ACTIVE,
      ...(excludedStickerIds.length
        ? { id: { notIn: excludedStickerIds } }
        : {})
    },
    orderBy: [{ sort_order: 'asc' }, { created: 'asc' }],
    select: {
      id: true,
      status: true,
      storage_key: true,
      width: true,
      height: true,
      size: true,
      media_type: true,
      thumbnail_storage_key: true
    }
  })

  return stickers.find(hasValidSticker) ?? null
}

const cleanupStickerObjects = async (keys: Array<string | null>) => {
  const uniqueKeys = [
    ...new Set(keys.filter((key): key is string => Boolean(key)))
  ]
  let failed = 0
  const concurrency = 10
  for (let index = 0; index < uniqueKeys.length; index += concurrency) {
    const batch = uniqueKeys.slice(index, index + concurrency)
    const results = await Promise.allSettled(
      batch.map((key) => deleteFileFromS3(key))
    )
    results.forEach((result, batchIndex) => {
      if (result.status === 'rejected') {
        failed += 1
        console.error('[Sticker] Failed to delete S3 object', {
          key: batch[batchIndex],
          error: result.reason
        })
      }
    })
  }
  return failed
}

const assertPackCanBeActive = async (
  tx: Prisma.TransactionClient,
  packId: number,
  coverStickerId: string | null | undefined
) => {
  const validSticker = await getValidCoverSticker(tx, packId, undefined)
  if (!validSticker || !hasValidSticker(validSticker)) {
    return 'Pack 至少需要一张有效 Sticker 才能上架'
  }

  const cover = await getValidCoverSticker(tx, packId, coverStickerId)
  if (!cover) {
    return '请先选择 Pack 内有效的封面 Sticker'
  }

  return null
}

export const createStickerPack = async (
  input: z.infer<typeof adminStickerPackCreateSchema>,
  uid: number
) => {
  const admin = await getAdmin(uid)
  if (typeof admin === 'string') {
    return admin
  }

  const exists = await prisma.sticker_pack.findUnique({
    where: { slug: input.slug },
    select: { id: true }
  })
  if (exists) {
    return 'Pack 标识已存在'
  }

  const packId = await prisma.$transaction(async (tx) => {
    const pack = await tx.sticker_pack.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        status: 0,
        is_builtin: true,
        price: 0
      }
    })
    await tx.admin_log.create({
      data: {
        type: 'create',
        user_id: uid,
        content: `管理员 ${admin.name} 创建了 Sticker Pack「${pack.name}」（${pack.slug}）`
      }
    })
    return pack.id
  })

  return (await getAdminStickerPacks(packId)).packs[0]
}

export const updateStickerPack = async (
  input: z.infer<typeof adminStickerPackUpdateSchema>,
  uid: number
) => {
  const admin = await getAdmin(uid)
  if (typeof admin === 'string') {
    return admin
  }

  const current = await prisma.sticker_pack.findUnique({
    where: { id: input.packId },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      status: true,
      cover_url: true,
      cover_storage_key: true,
      cover_sticker_id: true
    }
  })
  if (!current) {
    return '未找到 Sticker Pack'
  }

  let updated: AdminPackRecord
  try {
    updated = await prisma.$transaction(async (tx) => {
      let coverStickerId =
        input.coverStickerId === undefined
          ? current.cover_sticker_id
          : input.coverStickerId

      if (input.status === STICKER_PACK_ACTIVE) {
        const validCover = await getValidCoverSticker(
          tx,
          current.id,
          coverStickerId
        )
        if (!validCover) {
          const message = await assertPackCanBeActive(
            tx,
            current.id,
            coverStickerId
          )
          if (message) {
            throw new Error(message)
          }
        }
        if (!coverStickerId) {
          const fallback = await getValidCoverSticker(tx, current.id, undefined)
          coverStickerId = fallback?.id ?? null
        }
      } else if (coverStickerId) {
        const cover = await getValidCoverSticker(tx, current.id, coverStickerId)
        if (!cover) {
          throw new Error('封面 Sticker 不属于该 Pack 或已禁用')
        }
      }

      const pack = await tx.sticker_pack.update({
        where: { id: current.id },
        data: {
          name: input.name,
          description: input.description,
          status: input.status,
          cover_sticker_id: coverStickerId,
          ...(coverStickerId
            ? { cover_url: null, cover_storage_key: null }
            : {})
        },
        include: adminPackInclude
      })
      await tx.admin_log.create({
        data: {
          type: 'update',
          user_id: uid,
          content: `管理员 ${admin.name} 更新了 Sticker Pack「${current.name}」（${current.slug}）`
        }
      })
      return pack
    })
  } catch (error) {
    return error instanceof Error ? error.message : '更新 Sticker Pack 失败'
  }

  return mapPack(updated)
}

export const updateStickerStatus = async (
  input: z.infer<typeof adminStickerStatusSchema>,
  uid: number
) => {
  const admin = await getAdmin(uid)
  if (typeof admin === 'string') {
    return admin
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sticker = await tx.sticker.findUnique({
        where: { id: input.stickerId },
        select: {
          id: true,
          status: true,
          pack_id: true,
          storage_key: true,
          thumbnail_storage_key: true,
          mime: true,
          media_type: true,
          width: true,
          height: true,
          size: true,
          pack: {
            select: {
              name: true,
              slug: true,
              status: true,
              cover_sticker_id: true
            }
          }
        }
      })
      if (!sticker) {
        throw new Error('未找到 Sticker')
      }
      if (
        input.status === STICKER_ACTIVE &&
        !hasValidSticker({ ...sticker, status: STICKER_ACTIVE })
      ) {
        throw new Error('该 Sticker 资源无效，不能启用')
      }

      let coverStickerId = sticker.pack.cover_sticker_id
      if (
        input.status === 0 &&
        sticker.pack.status === STICKER_PACK_ACTIVE &&
        coverStickerId === sticker.id
      ) {
        const replacement = await getValidCoverSticker(
          tx,
          sticker.pack_id,
          undefined,
          [sticker.id]
        )
        if (!replacement || replacement.id === sticker.id) {
          throw new Error('该 Sticker 是当前上架 Pack 的唯一有效封面，不能禁用')
        }
        coverStickerId = replacement.id
      }

      await tx.sticker.update({
        where: { id: sticker.id },
        data: { status: input.status }
      })
      if (coverStickerId !== sticker.pack.cover_sticker_id) {
        await tx.sticker_pack.update({
          where: { id: sticker.pack_id },
          data: { cover_sticker_id: coverStickerId }
        })
      }
      await tx.admin_log.create({
        data: {
          type: 'update',
          user_id: uid,
          content: `管理员 ${admin.name} ${input.status === STICKER_ACTIVE ? '启用' : '禁用'}了 Sticker「${sticker.id}」`
        }
      })

      return sticker.pack_id
    })

    return (await getAdminStickerPacks(result)).packs[0]
  } catch (error) {
    return error instanceof Error ? error.message : '更新 Sticker 状态失败'
  }
}

export const updateStickerStatuses = async (
  input: z.infer<typeof adminStickerBatchStatusSchema>,
  uid: number
) => {
  const admin = await getAdmin(uid)
  if (typeof admin === 'string') {
    return admin
  }

  try {
    const packId = await prisma.$transaction(async (tx) => {
      const stickers = await tx.sticker.findMany({
        where: { id: { in: input.stickerIds } },
        select: {
          id: true,
          status: true,
          pack_id: true,
          storage_key: true,
          thumbnail_storage_key: true,
          media_type: true,
          width: true,
          height: true,
          size: true,
          pack: {
            select: {
              name: true,
              slug: true,
              status: true,
              cover_sticker_id: true
            }
          }
        }
      })
      if (stickers.length !== input.stickerIds.length) {
        throw new Error('部分 Sticker 不存在，请刷新后重试')
      }

      const packIds = new Set(stickers.map((sticker) => sticker.pack_id))
      if (packIds.size !== 1) {
        throw new Error('只能批量操作同一个 Pack 内的 Sticker')
      }

      if (
        input.status === STICKER_ACTIVE &&
        stickers.some(
          (sticker) => !hasValidSticker({ ...sticker, status: STICKER_ACTIVE })
        )
      ) {
        throw new Error('所选 Sticker 中包含无效资源，不能启用')
      }

      const pack = stickers[0].pack
      const packId = stickers[0].pack_id
      let coverStickerId = pack.cover_sticker_id
      if (
        input.status === 0 &&
        pack.status === STICKER_PACK_ACTIVE &&
        coverStickerId &&
        input.stickerIds.includes(coverStickerId)
      ) {
        const replacement = await getValidCoverSticker(
          tx,
          packId,
          undefined,
          input.stickerIds
        )
        if (!replacement) {
          throw new Error(
            '所选 Sticker 包含当前上架 Pack 的唯一有效封面，不能禁用'
          )
        }
        coverStickerId = replacement.id
      }

      await tx.sticker.updateMany({
        where: { id: { in: input.stickerIds }, pack_id: packId },
        data: { status: input.status }
      })
      if (coverStickerId !== pack.cover_sticker_id) {
        await tx.sticker_pack.update({
          where: { id: packId },
          data: { cover_sticker_id: coverStickerId }
        })
      }
      await tx.admin_log.create({
        data: {
          type: 'update',
          user_id: uid,
          content: `管理员 ${admin.name} 批量${input.status === STICKER_ACTIVE ? '启用' : '禁用'}了 Sticker Pack「${pack.name}」（${pack.slug}）中的 ${stickers.length} 个 Sticker`
        }
      })

      return packId
    })

    return (await getAdminStickerPacks(packId)).packs[0]
  } catch (error) {
    return error instanceof Error ? error.message : '批量更新 Sticker 状态失败'
  }
}

export const deleteStickers = async (
  input: z.infer<typeof adminStickerDeleteSchema>,
  uid: number
): Promise<AdminStickerDeleteResult | string> => {
  const admin = await getAdmin(uid)
  if (typeof admin === 'string') {
    return admin
  }

  try {
    const deleted = await prisma.$transaction(
      async (tx) => {
        const stickers = await tx.sticker.findMany({
          where: { id: { in: input.stickerIds } },
          select: {
            id: true,
            pack_id: true,
            storage_key: true,
            thumbnail_storage_key: true,
            pack: {
              select: {
                name: true,
                slug: true,
                status: true,
                cover_sticker_id: true
              }
            },
            _count: { select: { messages: true, reply_messages: true } }
          }
        })
        if (stickers.length !== input.stickerIds.length) {
          throw new Error('部分 Sticker 不存在，请刷新后重试')
        }

        const packIds = new Set(stickers.map((sticker) => sticker.pack_id))
        if (packIds.size !== 1) {
          throw new Error('只能批量删除同一个 Pack 内的 Sticker')
        }

        const pack = stickers[0].pack
        const packId = stickers[0].pack_id
        if (pack.status === STICKER_PACK_ACTIVE) {
          throw new Error('请先下架 Sticker Pack，再删除 Sticker')
        }
        if (
          stickers.some(
            (sticker) =>
              sticker._count.messages > 0 || sticker._count.reply_messages > 0
          )
        ) {
          throw new Error('所选 Sticker 已被历史消息引用，只能禁用，不能删除')
        }

        if (
          pack.cover_sticker_id &&
          input.stickerIds.includes(pack.cover_sticker_id)
        ) {
          const replacement = await getValidCoverSticker(
            tx,
            packId,
            undefined,
            input.stickerIds
          )
          await tx.sticker_pack.update({
            where: { id: packId },
            data: { cover_sticker_id: replacement?.id ?? null }
          })
        }

        await tx.sticker.deleteMany({
          where: { id: { in: input.stickerIds }, pack_id: packId }
        })
        await tx.admin_log.create({
          data: {
            type: 'delete',
            user_id: uid,
            content: `管理员 ${admin.name} 从 Sticker Pack「${pack.name}」（${pack.slug}）永久删除了 ${stickers.length} 个未使用 Sticker`
          }
        })

        return {
          packId,
          deletedCount: stickers.length,
          objectKeys: stickers.flatMap((sticker) => [
            sticker.storage_key,
            sticker.thumbnail_storage_key
          ])
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )

    const objectCleanupFailed = await cleanupStickerObjects(deleted.objectKeys)
    const pack = (await getAdminStickerPacks(deleted.packId)).packs[0]
    if (!pack) {
      return 'Sticker 已删除，但未能重新读取 Pack'
    }

    return {
      pack,
      deletedCount: deleted.deletedCount,
      objectCleanupFailed
    }
  } catch (error) {
    return error instanceof Error ? error.message : '删除 Sticker 失败'
  }
}

export const deleteStickerPack = async (
  input: z.infer<typeof adminStickerPackDeleteSchema>,
  uid: number
): Promise<AdminStickerPackDeleteResult | string> => {
  const admin = await getAdmin(uid)
  if (typeof admin === 'string') {
    return admin
  }

  try {
    const deleted = await prisma.$transaction(
      async (tx) => {
        const pack = await tx.sticker_pack.findUnique({
          where: { id: input.packId },
          select: {
            id: true,
            slug: true,
            name: true,
            status: true,
            cover_storage_key: true,
            ownerships: { select: { id: true }, take: 1 },
            stickers: {
              select: {
                id: true,
                storage_key: true,
                thumbnail_storage_key: true,
                _count: { select: { messages: true, reply_messages: true } }
              }
            }
          }
        })
        if (!pack) {
          throw new Error('未找到 Sticker Pack')
        }
        if (pack.status === STICKER_PACK_ACTIVE) {
          throw new Error('请先下架 Sticker Pack，再永久删除')
        }
        if (pack.ownerships.length > 0) {
          throw new Error('该 Sticker Pack 已存在用户所有权记录，不能永久删除')
        }
        if (
          pack.stickers.some(
            (sticker) =>
              sticker._count.messages > 0 || sticker._count.reply_messages > 0
          )
        ) {
          throw new Error(
            '该 Sticker Pack 中有 Sticker 被历史消息引用，只能下架，不能删除'
          )
        }

        await tx.sticker_pack.update({
          where: { id: pack.id },
          data: { cover_sticker_id: null }
        })
        await tx.sticker.deleteMany({ where: { pack_id: pack.id } })
        await tx.sticker_pack.delete({ where: { id: pack.id } })
        await tx.admin_log.create({
          data: {
            type: 'delete',
            user_id: uid,
            content: `管理员 ${admin.name} 永久删除了 Sticker Pack「${pack.name}」（${pack.slug}）及其中 ${pack.stickers.length} 个未使用 Sticker`
          }
        })

        return {
          packId: pack.id,
          deletedStickerCount: pack.stickers.length,
          objectKeys: [
            pack.cover_storage_key,
            ...pack.stickers.flatMap((sticker) => [
              sticker.storage_key,
              sticker.thumbnail_storage_key
            ])
          ]
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )

    return {
      packId: deleted.packId,
      deletedStickerCount: deleted.deletedStickerCount,
      objectCleanupFailed: await cleanupStickerObjects(deleted.objectKeys)
    }
  } catch (error) {
    return error instanceof Error ? error.message : '删除 Sticker Pack 失败'
  }
}

const formatImportFailures = (failures: ImportFailure[]) =>
  `Sticker 导入失败：\n${failures
    .map(({ name, reason }) => `- ${name}: ${reason}`)
    .join('\n')}`

const getStickerAlt = (fileName: string) =>
  path
    .basename(fileName, path.extname(fileName))
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 255)

type ImportStickerInput = {
  packId: number | null
  slug?: string
  name?: string
  description?: string
  files: StickerSourceFile[]
  uid: number
}

type PreparedImportSticker = {
  source: StickerSourceFile
  asset: ParsedStickerAsset
  id: string
  alt: string
  assetKey: string
  posterKey: string | null
}

export const importStickerAssets = async (input: ImportStickerInput) => {
  const admin = await getAdmin(input.uid)
  if (typeof admin === 'string') {
    return admin
  }

  if (!input.files.length) {
    return '请至少选择一个 WebP、WebM 或 ZIP 文件'
  }
  if (input.files.length > STICKER_MAX_IMPORT_ITEMS) {
    return `单次最多导入 ${STICKER_MAX_IMPORT_ITEMS} 个文件`
  }
  const totalBytes = input.files.reduce(
    (sum, file) => sum + file.buffer.byteLength,
    0
  )
  if (totalBytes > STICKER_MAX_IMPORT_BYTES) {
    return `单次导入文件总大小不能超过 ${STICKER_MAX_IMPORT_BYTES / 1024 / 1024} MB`
  }

  let pack = input.packId
    ? await prisma.sticker_pack.findUnique({
        where: { id: input.packId },
        select: { id: true, slug: true, name: true, status: true }
      })
    : null
  if (input.packId && !pack) {
    return '未找到目标 Sticker Pack'
  }
  if (!pack && (!input.slug || !input.name)) {
    return '创建新 Pack 时必须填写英文标识和展示名称'
  }
  if (!pack) {
    const packInput = adminStickerPackCreateSchema.safeParse({
      slug: input.slug,
      name: input.name,
      description: input.description ?? ''
    })
    if (!packInput.success) {
      return packInput.error.issues[0]?.message ?? '新建 Pack 参数无效'
    }
  }

  if (!pack && input.slug) {
    const exists = await prisma.sticker_pack.findUnique({
      where: { slug: input.slug },
      select: { id: true }
    })
    if (exists) {
      return 'Pack 标识已存在，请选择已有 Pack'
    }
  }

  const sources: StickerSourceFile[] = []
  const failures: ImportFailure[] = []
  for (const source of input.files) {
    if (path.extname(source.name).toLowerCase() !== '.zip') {
      sources.push(source)
      continue
    }

    try {
      sources.push(...(await extractStickerZip(source)))
    } catch (error) {
      failures.push({
        name: source.name,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
  if (failures.length) {
    return formatImportFailures(failures)
  }
  if (sources.length > STICKER_MAX_IMPORT_ITEMS) {
    return `单次最多导入 ${STICKER_MAX_IMPORT_ITEMS} 个 Sticker`
  }
  if (!sources.length) {
    return 'ZIP 中没有可导入的 WebP 或 WebM Sticker'
  }
  const sourceBytes = sources.reduce(
    (sum, source) => sum + source.buffer.byteLength,
    0
  )
  if (sourceBytes > STICKER_MAX_IMPORT_BYTES) {
    return `解压后的 Sticker 总大小不能超过 ${STICKER_MAX_IMPORT_BYTES / 1024 / 1024} MB`
  }

  const prepared: PreparedImportSticker[] = []
  const contentHashes = new Set<string>()
  for (const source of sources) {
    try {
      const asset = await parseStickerAsset(source)
      if (contentHashes.has(asset.contentHash)) {
        failures.push({ name: source.name, reason: '导入内容重复' })
        continue
      }
      contentHashes.add(asset.contentHash)
      const slug = pack?.slug ?? input.slug!
      const id = buildStickerId(slug, source.name, asset.contentHash)
      prepared.push({
        source,
        asset,
        id,
        alt: getStickerAlt(source.name),
        assetKey: getStickerAssetKey(slug, id, asset.extension),
        posterKey:
          asset.mediaType === 'video' && asset.poster
            ? getStickerPosterKey(slug, id, asset.poster)
            : null
      })
    } catch (error) {
      failures.push({
        name: source.name,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
  if (failures.length) {
    return formatImportFailures(failures)
  }

  if (pack) {
    const duplicates = await prisma.sticker.findMany({
      where: {
        pack_id: pack.id,
        OR: [
          {
            content_hash: { in: prepared.map(({ asset }) => asset.contentHash) }
          },
          { id: { in: prepared.map(({ id }) => id) } }
        ]
      },
      select: { id: true, content_hash: true }
    })
    if (duplicates.length) {
      return formatImportFailures(
        duplicates.map((duplicate) => ({
          name:
            prepared.find(
              ({ id, asset }) =>
                id === duplicate.id ||
                asset.contentHash === duplicate.content_hash
            )?.source.name ?? duplicate.id,
          reason: '该资源已经存在于目标 Pack'
        }))
      )
    }
  }

  const uploadedKeys: string[] = []
  try {
    for (const item of prepared) {
      await uploadBufferToS3(
        item.assetKey,
        item.asset.asset,
        item.asset.mime,
        STICKER_CACHE_CONTROL
      )
      uploadedKeys.push(item.assetKey)
      if (item.posterKey && item.asset.poster) {
        await uploadBufferToS3(
          item.posterKey,
          item.asset.poster,
          'image/webp',
          STICKER_CACHE_CONTROL
        )
        uploadedKeys.push(item.posterKey)
      }
    }

    const packId = await prisma.$transaction(async (tx) => {
      const targetPack = pack
        ? await tx.sticker_pack.findUnique({ where: { id: pack.id } })
        : await tx.sticker_pack.create({
            data: {
              slug: input.slug!,
              name: input.name!,
              description: input.description ?? '',
              status: 0,
              is_builtin: true,
              price: 0
            }
          })
      if (!targetPack) {
        throw new Error('未找到目标 Sticker Pack')
      }

      const sortOrder = await tx.sticker.aggregate({
        where: { pack_id: targetPack.id },
        _max: { sort_order: true }
      })
      const createdIds: string[] = []
      for (const [index, item] of prepared.entries()) {
        const created = await tx.sticker.create({
          data: {
            id: item.id,
            pack_id: targetPack.id,
            alt: item.alt,
            asset_url: null,
            thumbnail_url: null,
            storage_key: item.assetKey,
            thumbnail_storage_key: item.posterKey,
            mime: item.asset.mime,
            media_type: item.asset.mediaType,
            status: STICKER_ACTIVE,
            content_hash: item.asset.contentHash,
            width: item.asset.width,
            height: item.asset.height,
            size: item.asset.size,
            duration_ms: item.asset.durationMs,
            frame_rate: item.asset.frameRate,
            sort_order: (sortOrder._max.sort_order ?? -1) + index + 1
          }
        })
        createdIds.push(created.id)
      }

      const currentCover = targetPack.cover_sticker_id
        ? await getValidCoverSticker(
            tx,
            targetPack.id,
            targetPack.cover_sticker_id
          )
        : null
      if (!currentCover) {
        await tx.sticker_pack.update({
          where: { id: targetPack.id },
          data: {
            cover_sticker_id: createdIds[0],
            cover_url: null,
            cover_storage_key: null
          }
        })
      }

      await tx.admin_log.create({
        data: {
          type: 'create',
          user_id: input.uid,
          content: `管理员 ${admin.name} 向 Sticker Pack「${targetPack.name}」（${targetPack.slug}）导入了 ${createdIds.length} 个 Sticker`
        }
      })
      return targetPack.id
    })

    return (await getAdminStickerPacks(packId)).packs[0]
  } catch (error) {
    await Promise.allSettled(
      uploadedKeys.map(async (key) => {
        try {
          await deleteFileFromS3(key)
        } catch (cleanupError) {
          console.error('[Sticker] Failed to compensate S3 object', {
            key,
            error: cleanupError
          })
        }
      })
    )
    console.error('[Sticker] Failed to import Sticker assets', error)
    return 'Sticker 导入失败，已回滚数据库记录，请稍后重试'
  }
}
