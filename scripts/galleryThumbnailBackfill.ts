import 'dotenv/config'
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  preparePatchGalleryThumbnail,
  type PreparedGalleryThumbnail
} from '~/app/api/edit/galleryUpload'

const DEFAULT_BATCH_SIZE = 20
const DEFAULT_APPLY_LIMIT = 50
const DEFAULT_APPLY_DELAY_MS = 1000
const MAX_BATCH_SIZE = 200
const MAX_CONCURRENCY = 4
const DEFAULT_MAX_ORIGINAL_MB = 8
const ONE_MEGABYTE = 1024 * 1024
const PATCH_CONTENT_CACHE_BATCH_SIZE = 50
const ORIGINAL_TOO_LARGE_REASON_PREFIX = 'original is too large:'

export interface GalleryThumbnailBackfillOptions {
  apply: boolean
  batchSize: number
  concurrency: number
  delayMs: number
  limit?: number
  patchId?: number
  startId?: number
  maxOriginalBytes: number
  skipAnimatedAvif: boolean
  verbose: boolean
}

export interface GalleryThumbnailBackfillImage {
  id: number
  patch_id: number
  url: string
  thumbnail_url: string | null
  patch: {
    unique_id: string
    name: string
  }
}

export interface GalleryThumbnailBackfillDependencies {
  getGalleryStats: (
    args: GalleryThumbnailBackfillStatsArgs
  ) => Promise<GalleryThumbnailBackfillStats>
  findImages: (
    args: GalleryThumbnailBackfillFindArgs
  ) => Promise<GalleryThumbnailBackfillImage[]>
  updateThumbnailUrl: (
    imageId: number,
    thumbnailUrl: string
  ) => Promise<{ count: number }>
  downloadOriginal: (key: string) => Promise<Buffer>
  prepareThumbnail: (
    image: Buffer,
    options: { skipAnimatedAvif: boolean }
  ) => Promise<PreparedGalleryThumbnail | string>
  uploadThumbnail: (
    key: string,
    buffer: Buffer,
    contentType: PreparedGalleryThumbnail['contentType']
  ) => Promise<void>
  deleteThumbnail: (key: string) => Promise<void>
  invalidatePatchContentCache: (uniqueId: string) => Promise<void>
}

export interface GalleryThumbnailBackfillFindArgs {
  afterId: number
  take: number
  patchId?: number
}

export interface GalleryThumbnailBackfillStatsArgs {
  patchId?: number
  startId?: number
}

export interface GalleryThumbnailBackfillStats {
  total: number
  withThumbnail: number
  missingThumbnail: number
}

type GalleryThumbnailBackfillImageResult =
  | {
      status: 'dry-run'
      imageId: number
      patchUniqueId: string
      originalKey: string
      reason?: string
    }
  | {
      status: 'updated'
      imageId: number
      patchUniqueId: string
      originalKey: string
      thumbnailKey: string
      thumbnailUrl: string
      source: PreparedGalleryThumbnail['source']
    }
  | {
      status: 'skipped'
      imageId: number
      patchUniqueId: string
      reason: string
    }
  | {
      status: 'failed'
      imageId: number
      patchUniqueId: string
      reason: string
    }

export interface GalleryThumbnailBackfillRunResult {
  galleryTotal: number
  alreadyWithThumbnail: number
  missingThumbnail: number
  scanned: number
  eligible: number
  updated: number
  skipped: number
  failed: number
  affectedUniqueIds: string[]
  failures: { imageId: number; reason: string }[]
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const parseIntegerArg = (value: string | undefined) => {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.floor(parsed)
}

const getArgValue = (args: string[], name: string) => {
  const prefix = `${name}=`
  const match = args.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

export const buildGalleryThumbnailBackfillOptions = (
  args = process.argv.slice(2)
): GalleryThumbnailBackfillOptions => {
  const apply = args.includes('--apply')
  const limitArg = parseIntegerArg(getArgValue(args, '--limit'))
  const batchArg = parseIntegerArg(getArgValue(args, '--batch'))
  const concurrencyArg = parseIntegerArg(getArgValue(args, '--concurrency'))
  const delayArg = parseIntegerArg(getArgValue(args, '--delay'))
  const patchIdArg = parseIntegerArg(getArgValue(args, '--patch-id'))
  const startIdArg = parseIntegerArg(getArgValue(args, '--start-id'))
  const maxOriginalMbArg = parseIntegerArg(
    getArgValue(args, '--max-original-mb')
  )

  return {
    apply,
    batchSize: clamp(batchArg ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
    concurrency: clamp(concurrencyArg ?? 1, 1, MAX_CONCURRENCY),
    delayMs: clamp(delayArg ?? (apply ? DEFAULT_APPLY_DELAY_MS : 0), 0, 60_000),
    limit:
      limitArg === undefined
        ? apply
          ? DEFAULT_APPLY_LIMIT
          : undefined
        : limitArg > 0
          ? limitArg
          : undefined,
    patchId: patchIdArg && patchIdArg > 0 ? patchIdArg : undefined,
    startId: startIdArg && startIdArg > 0 ? startIdArg : undefined,
    maxOriginalBytes:
      clamp(maxOriginalMbArg ?? DEFAULT_MAX_ORIGINAL_MB, 1, 50) * ONE_MEGABYTE,
    skipAnimatedAvif: args.includes('--skip-animated-avif'),
    verbose: args.includes('--verbose')
  }
}

const getPublicImageBaseUrl = () =>
  process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL ??
  process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL

const normalizeUrlPrefix = (value: string | undefined) => {
  if (!value) return null
  return value.endsWith('/') ? value : `${value}/`
}

export const getGalleryBackfillS3Key = (url: string) => {
  const prefixes = [
    normalizeUrlPrefix(process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL),
    normalizeUrlPrefix(process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL)
  ].filter((prefix): prefix is string => Boolean(prefix))

  for (const prefix of prefixes) {
    if (url.startsWith(prefix)) {
      return url.slice(prefix.length)
    }
  }

  return null
}

export const getGalleryBackfillThumbnailKey = (
  image: Pick<GalleryThumbnailBackfillImage, 'id' | 'patch_id'>,
  extension: PreparedGalleryThumbnail['extension']
) => `patch/${image.patch_id}/gallery/thumbnail/thumb-${image.id}.${extension}`

const getGalleryBackfillThumbnailUrl = (thumbnailKey: string) => {
  const baseUrl = getPublicImageBaseUrl()
  if (!baseUrl) {
    throw new Error(
      'Missing KUN_VISUAL_NOVEL_IMAGE_BED_URL or NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL'
    )
  }

  return `${baseUrl.replace(/\/$/, '')}/${thumbnailKey}`
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const isCanonicalGalleryOriginalKey = (
  image: Pick<GalleryThumbnailBackfillImage, 'id' | 'patch_id'>,
  key: string
) => {
  const prefix = `patch/${image.patch_id}/gallery/${image.id}.`
  return key.startsWith(prefix) && !key.includes('/thumbnail/')
}

const bufferFromS3Body = async (body: unknown) => {
  if (!body) {
    throw new Error('S3 object body is empty')
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body)
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  ) {
    return Buffer.from(await body.transformToByteArray())
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    Symbol.asyncIterator in body
  ) {
    const chunks: Buffer[] = []
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  throw new Error('Unsupported S3 object body')
}

export const downloadGalleryOriginalFromS3 = async (key: string) => {
  const { s3 } = await import('~/lib/s3')
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME!,
      Key: key
    })
  )

  return bufferFromS3Body(result.Body)
}

export const downloadGalleryOriginalFromS3WithinLimit = async (
  key: string,
  maxBytes: number
) => {
  const { s3 } = await import('~/lib/s3')
  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: process.env.KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME!,
      Key: key
    })
  )
  if (head.ContentLength && head.ContentLength > maxBytes) {
    throw new Error(
      `${ORIGINAL_TOO_LARGE_REASON_PREFIX} ${head.ContentLength} bytes`
    )
  }

  const result = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME!,
      Key: key
    })
  )

  if (result.ContentLength && result.ContentLength > maxBytes) {
    throw new Error(
      `${ORIGINAL_TOO_LARGE_REASON_PREFIX} ${result.ContentLength} bytes`
    )
  }

  const buffer = await bufferFromS3Body(result.Body)
  if (buffer.byteLength > maxBytes) {
    throw new Error(
      `${ORIGINAL_TOO_LARGE_REASON_PREFIX} ${buffer.byteLength} bytes`
    )
  }

  return buffer
}

export const createGalleryThumbnailBackfillDependencies = async (
  options: Pick<
    GalleryThumbnailBackfillOptions,
    'maxOriginalBytes'
  > = buildGalleryThumbnailBackfillOptions()
): Promise<
  GalleryThumbnailBackfillDependencies & { close: () => Promise<void> }
> => {
  const pg = await import('pg')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('@prisma/client')
  let redisModule: Awaited<typeof import('~/lib/redis')> | undefined

  const Pool = pg.default?.Pool ?? pg.Pool
  const pool = new Pool({
    connectionString: process.env.KUN_DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
  })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  return {
    getGalleryStats: async ({ patchId, startId }) => {
      const stats = await prisma.$queryRaw<
        {
          total: bigint
          with_thumbnail: bigint
          missing_thumbnail: bigint
        }[]
      >`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE thumbnail_url IS NOT NULL) AS with_thumbnail,
          COUNT(*) FILTER (WHERE thumbnail_url IS NULL) AS missing_thumbnail
        FROM patch_game_image
        WHERE url <> ''
          AND (${patchId ?? null}::int IS NULL OR patch_id = ${patchId ?? null}::int)
          AND (${startId ?? null}::int IS NULL OR id > ${startId ?? null}::int)
      `

      const row = stats[0]
      return {
        total: Number(row?.total ?? 0n),
        withThumbnail: Number(row?.with_thumbnail ?? 0n),
        missingThumbnail: Number(row?.missing_thumbnail ?? 0n)
      }
    },
    findImages: ({ afterId, take, patchId }) =>
      prisma.patch_game_image.findMany({
        where: {
          id: { gt: afterId },
          thumbnail_url: null,
          url: { not: '' },
          ...(patchId ? { patch_id: patchId } : {})
        },
        orderBy: { id: 'asc' },
        take,
        select: {
          id: true,
          patch_id: true,
          url: true,
          thumbnail_url: true,
          patch: {
            select: {
              unique_id: true,
              name: true
            }
          }
        }
      }),
    updateThumbnailUrl: (imageId, thumbnailUrl) =>
      prisma.patch_game_image.updateMany({
        where: {
          id: imageId,
          thumbnail_url: null
        },
        data: {
          thumbnail_url: thumbnailUrl
        }
      }),
    downloadOriginal: (key) =>
      downloadGalleryOriginalFromS3WithinLimit(key, options.maxOriginalBytes),
    prepareThumbnail: preparePatchGalleryThumbnail,
    uploadThumbnail: async (key, buffer, contentType) => {
      const { uploadImageToS3 } = await import('~/lib/s3')
      await uploadImageToS3(key, buffer, contentType)
    },
    deleteThumbnail: async (key) => {
      const { deleteFileFromS3 } = await import('~/lib/s3')
      await deleteFileFromS3(key)
    },
    invalidatePatchContentCache: async (uniqueId) => {
      const cache = await import('~/app/api/patch/cache')
      redisModule ??= await import('~/lib/redis')
      await cache.invalidatePatchContentCache(uniqueId)
    },
    close: async () => {
      await prisma.$disconnect()
      await pool.end().catch(() => undefined)
      redisModule?.redis.disconnect()
    }
  }
}

export const processGalleryThumbnailBackfillImage = async (
  image: GalleryThumbnailBackfillImage,
  options: GalleryThumbnailBackfillOptions,
  dependencies: GalleryThumbnailBackfillDependencies
): Promise<GalleryThumbnailBackfillImageResult> => {
  const originalKey = getGalleryBackfillS3Key(image.url)
  if (!originalKey) {
    return {
      status: 'skipped',
      imageId: image.id,
      patchUniqueId: image.patch.unique_id,
      reason: 'original URL is not a configured S3/image-bed URL'
    }
  }

  if (!isCanonicalGalleryOriginalKey(image, originalKey)) {
    return {
      status: 'skipped',
      imageId: image.id,
      patchUniqueId: image.patch.unique_id,
      reason: `original key is not canonical gallery path: ${originalKey}`
    }
  }

  if (!options.apply) {
    return {
      status: 'dry-run',
      imageId: image.id,
      patchUniqueId: image.patch.unique_id,
      originalKey
    }
  }

  try {
    const original = await dependencies.downloadOriginal(originalKey)
    if (original.byteLength > options.maxOriginalBytes) {
      return {
        status: 'skipped',
        imageId: image.id,
        patchUniqueId: image.patch.unique_id,
        reason: `original is too large: ${original.byteLength} bytes`
      }
    }

    const thumbnail = await dependencies.prepareThumbnail(original, {
      skipAnimatedAvif: options.skipAnimatedAvif
    })
    if (typeof thumbnail === 'string') {
      return {
        status: 'skipped',
        imageId: image.id,
        patchUniqueId: image.patch.unique_id,
        reason: thumbnail
      }
    }

    const thumbnailKey = getGalleryBackfillThumbnailKey(
      image,
      thumbnail.extension
    )
    const thumbnailUrl = getGalleryBackfillThumbnailUrl(thumbnailKey)

    await dependencies.uploadThumbnail(
      thumbnailKey,
      thumbnail.buffer,
      thumbnail.contentType
    )

    try {
      const result = await dependencies.updateThumbnailUrl(
        image.id,
        thumbnailUrl
      )
      if (result.count === 0) {
        await dependencies.deleteThumbnail(thumbnailKey).catch(() => undefined)
        return {
          status: 'skipped',
          imageId: image.id,
          patchUniqueId: image.patch.unique_id,
          reason: 'thumbnail_url was already updated by another process'
        }
      }
    } catch (error) {
      await dependencies.deleteThumbnail(thumbnailKey).catch(() => undefined)
      throw error
    }

    return {
      status: 'updated',
      imageId: image.id,
      patchUniqueId: image.patch.unique_id,
      originalKey,
      thumbnailKey,
      thumbnailUrl,
      source: thumbnail.source
    }
  } catch (error) {
    const reason = getErrorMessage(error)
    if (reason.startsWith(ORIGINAL_TOO_LARGE_REASON_PREFIX)) {
      return {
        status: 'skipped',
        imageId: image.id,
        patchUniqueId: image.patch.unique_id,
        reason
      }
    }

    return {
      status: 'failed',
      imageId: image.id,
      patchUniqueId: image.patch.unique_id,
      reason
    }
  }
}

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) => {
  let index = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const current = index
        index += 1
        if (current >= items.length) {
          return
        }
        await worker(items[current])
      }
    }
  )

  await Promise.all(workers)
}

const formatApplyImageTarget = (image: GalleryThumbnailBackfillImage) =>
  `patch #${image.patch_id} ${image.patch.unique_id} ${image.patch.name}: gallery image #${image.id}`

const logApplyImageStart = (image: GalleryThumbnailBackfillImage) => {
  console.log(`Processing ${formatApplyImageTarget(image)}`)
}

const logApplyImageCompletion = (
  image: GalleryThumbnailBackfillImage,
  result: GalleryThumbnailBackfillImageResult,
  durationMs: number
) => {
  const target = formatApplyImageTarget(image)

  if (result.status === 'updated') {
    console.log(`Updated ${target} (${result.source}) in ${durationMs}ms`)
    return
  }

  if (result.status === 'skipped') {
    console.log(`Skipped ${target} in ${durationMs}ms: ${result.reason}`)
    return
  }

  if (result.status === 'failed') {
    console.log(`Failed ${target} in ${durationMs}ms: ${result.reason}`)
    return
  }

  if (result.status === 'dry-run') {
    console.log(
      `Would backfill ${target} in ${durationMs}ms: ${result.originalKey}`
    )
  }
}

export const runGalleryThumbnailBackfill = async (
  options: GalleryThumbnailBackfillOptions,
  dependencies: GalleryThumbnailBackfillDependencies
): Promise<GalleryThumbnailBackfillRunResult> => {
  const stats = await dependencies.getGalleryStats({
    patchId: options.patchId,
    startId: options.startId
  })
  const result: GalleryThumbnailBackfillRunResult = {
    galleryTotal: stats.total,
    alreadyWithThumbnail: stats.withThumbnail,
    missingThumbnail: stats.missingThumbnail,
    scanned: 0,
    eligible: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    affectedUniqueIds: [],
    failures: []
  }
  const affectedUniqueIds = new Set<string>()
  let cursor = options.startId ?? 0

  for (;;) {
    const remaining =
      options.limit === undefined
        ? options.batchSize
        : options.limit - result.scanned
    if (remaining <= 0) break

    const images = await dependencies.findImages({
      afterId: cursor,
      take: Math.min(options.batchSize, remaining),
      patchId: options.patchId
    })
    if (!images.length) break

    for (const image of images) {
      cursor = image.id
    }

    await runWithConcurrency(images, options.concurrency, async (image) => {
      const startedAt = Date.now()
      if (options.apply) {
        logApplyImageStart(image)
      }

      const imageResult = await processGalleryThumbnailBackfillImage(
        image,
        options,
        dependencies
      )
      if (options.apply) {
        logApplyImageCompletion(image, imageResult, Date.now() - startedAt)
      }

      result.scanned += 1
      if (imageResult.status === 'dry-run') {
        result.eligible += 1
      } else if (imageResult.status === 'updated') {
        result.eligible += 1
        result.updated += 1
        affectedUniqueIds.add(imageResult.patchUniqueId)
      } else if (imageResult.status === 'skipped') {
        result.skipped += 1
      } else {
        result.failed += 1
        result.failures.push({
          imageId: imageResult.imageId,
          reason: imageResult.reason
        })
      }

      if (options.verbose) {
        logImageResult(imageResult)
      }

      await sleep(options.delayMs)
    })
  }

  result.affectedUniqueIds = [...affectedUniqueIds]

  if (options.apply && result.affectedUniqueIds.length > 0) {
    for (
      let index = 0;
      index < result.affectedUniqueIds.length;
      index += PATCH_CONTENT_CACHE_BATCH_SIZE
    ) {
      await Promise.all(
        result.affectedUniqueIds
          .slice(index, index + PATCH_CONTENT_CACHE_BATCH_SIZE)
          .map((uniqueId) => dependencies.invalidatePatchContentCache(uniqueId))
      )
    }
  }

  return result
}

const logImageResult = (result: GalleryThumbnailBackfillImageResult) => {
  if (result.status === 'dry-run') {
    console.log(
      `Would backfill gallery image #${result.imageId}: ${result.originalKey}`
    )
    return
  }

  if (result.status === 'updated') {
    console.log(
      `Backfilled gallery image #${result.imageId}: ${result.thumbnailKey} (${result.source})`
    )
    return
  }

  console.log(
    `${result.status === 'skipped' ? 'Skipped' : 'Failed'} gallery image #${result.imageId}: ${result.reason}`
  )
}

export const printGalleryThumbnailBackfillSummary = (
  options: GalleryThumbnailBackfillOptions,
  result: GalleryThumbnailBackfillRunResult
) => {
  const mode = options.apply ? 'Apply' : 'Dry run'
  console.log(
    `${mode} complete. galleryTotal=${result.galleryTotal}, alreadyWithThumbnail=${result.alreadyWithThumbnail}, missingThumbnail=${result.missingThumbnail}, scanned=${result.scanned}, eligible=${result.eligible}, updated=${result.updated}, skipped=${result.skipped}, failed=${result.failed}`
  )

  if (options.apply) {
    console.log(
      `Invalidated patch content caches: ${result.affectedUniqueIds.length}`
    )
  }

  if (result.failures.length > 0) {
    console.log('Failures:')
    for (const failure of result.failures) {
      console.log(`  #${failure.imageId}: ${failure.reason}`)
    }
  }
}

const shouldRunCli = () => {
  const entry = process.argv[1]
  return Boolean(
    entry && import.meta.url === pathToFileURL(resolve(entry)).href
  )
}

if (shouldRunCli()) {
  const options = buildGalleryThumbnailBackfillOptions()
  let dependencies:
    | (GalleryThumbnailBackfillDependencies & { close: () => Promise<void> })
    | undefined

  createGalleryThumbnailBackfillDependencies(options)
    .then(async (createdDependencies) => {
      dependencies = createdDependencies
      if (!options.apply) {
        console.log('Running gallery thumbnail backfill in dry-run mode.')
      } else {
        console.log(
          `Running gallery thumbnail backfill apply mode with limit=${options.limit ?? 'all'}, batch=${options.batchSize}, concurrency=${options.concurrency}, delay=${options.delayMs}ms.`
        )
      }

      const result = await runGalleryThumbnailBackfill(options, dependencies)
      printGalleryThumbnailBackfillSummary(options, result)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      await dependencies?.close()
    })
}
