import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { deleteFileFromS3 } from '~/lib/s3'
import { purgeCloudflareCache } from '~/app/api/utils/purgeCloudflareCache'
import { PATCH_SUBMISSION_ACTIVE_STATUSES } from '~/constants/patchSubmission'

export const PATCH_SUBMISSION_ASSET_PREFIX = 'patch-submission/'

export type SubmissionOrphanCleanupSource =
  | 'orphan_scan'
  | 'gallery_delete'
  | 'banner_replace'
  | 'upload_compensation'
  | 'patch_delete'

type CleanupClient = Prisma.TransactionClient | typeof prisma

const publicAssetBases = () => [
  ...new Set(
    [
      process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL,
      process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL
    ]
      .map((base) => base?.trim().replace(/\/+$/, ''))
      .filter((base): base is string => Boolean(base))
  )
]

const isPublicHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export const parseSubmissionAssetPurgeUrls = (
  value: Prisma.JsonValue
): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (url): url is string =>
              typeof url === 'string' && isPublicHttpUrl(url)
          )
        )
      ]
    : []

export const buildSubmissionAssetPublicUrls = (keys: string[]) =>
  publicAssetBases().flatMap((base) => keys.map((key) => `${base}/${key}`))

const extractSubmissionAssetKey = (url: string) => {
  for (const base of publicAssetBases()) {
    if (url.startsWith(`${base}/`)) {
      const key = url.slice(base.length + 1)
      return key.startsWith(PATCH_SUBMISSION_ASSET_PREFIX) ? key : null
    }
  }

  // Serving-reference checks fail safe. A patch may still store a URL from a
  // previous CDN hostname after configuration changes; recognizing the
  // dedicated path on an otherwise valid HTTP URL can only over-protect an
  // object, never authorize deletion of an external key.
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    const marker = `/${PATCH_SUBMISSION_ASSET_PREFIX}`
    const at = parsed.pathname.indexOf(marker)
    return at >= 0 ? parsed.pathname.slice(at + 1) : null
  } catch {
    return null
  }
}

const mergeUnique = (left: string[], right: string[]) => [
  ...new Set([...left, ...right])
]

/**
 * Creates durable retry credentials inside the caller's short DB transaction.
 * No storage or HTTP work happens here. Existing URLs are retained so a later
 * hostname change cannot erase the edge location that still needs purging.
 */
export const enqueueSubmissionOrphanCleanupJobs = async (
  client: CleanupClient,
  keys: string[],
  source: SubmissionOrphanCleanupSource
) => {
  const uniqueKeys = [...new Set(keys.filter(Boolean))]
  for (const key of uniqueKeys) {
    if (!key.startsWith(PATCH_SUBMISSION_ASSET_PREFIX)) {
      throw new Error(`Refused to enqueue a non-submission asset: ${key}`)
    }
  }

  for (const key of uniqueKeys) {
    const currentUrls = buildSubmissionAssetPublicUrls([key])
    const persisted = await client.patch_submission_orphan_cleanup.upsert({
      where: { object_key: key },
      create: {
        object_key: key,
        purge_urls: currentUrls,
        source
      },
      update: {},
      select: { purge_urls: true }
    })
    const storedUrls = parseSubmissionAssetPurgeUrls(persisted.purge_urls)
    const mergedUrls = mergeUnique(storedUrls, currentUrls)
    if (mergedUrls.length !== storedUrls.length) {
      await client.patch_submission_orphan_cleanup.update({
        where: { object_key: key },
        data: { purge_urls: mergedUrls }
      })
    }
  }

  return uniqueKeys
}

interface ServingReferenceClient {
  patch_submission: Pick<typeof prisma.patch_submission, 'findMany'>
  patch: Pick<typeof prisma.patch, 'findMany'>
  patch_game_image: Pick<typeof prisma.patch_game_image, 'findMany'>
}

/**
 * The single serving-reference projection used by both S3 discovery and job
 * execution. Published submission rows are deliberately absent: their keys are
 * provenance only; the live patch rows decide what still serves traffic.
 */
export const loadServingSubmissionAssetKeys = async (
  client: ServingReferenceClient = prisma
) => {
  const referenced = new Set<string>()
  const [submissions, patches, gallery] = await Promise.all([
    client.patch_submission.findMany({
      where: { status: { in: [...PATCH_SUBMISSION_ACTIVE_STATUSES] } },
      select: {
        banner_key: true,
        banner_thumbnail_key: true,
        banner_original_key: true,
        gallery: { select: { image_key: true, thumbnail_key: true } }
      }
    }),
    client.patch.findMany({
      where: { banner: { contains: PATCH_SUBMISSION_ASSET_PREFIX } },
      select: { banner: true }
    }),
    client.patch_game_image.findMany({
      where: {
        OR: [
          { url: { contains: PATCH_SUBMISSION_ASSET_PREFIX } },
          { thumbnail_url: { contains: PATCH_SUBMISSION_ASSET_PREFIX } }
        ]
      },
      select: { url: true, thumbnail_url: true }
    })
  ])

  for (const submission of submissions) {
    for (const key of [
      submission.banner_key,
      submission.banner_thumbnail_key,
      submission.banner_original_key,
      ...submission.gallery.flatMap((image) => [
        image.image_key,
        image.thumbnail_key
      ])
    ]) {
      if (key) referenced.add(key)
    }
  }

  for (const patch of patches) {
    const key = extractSubmissionAssetKey(patch.banner)
    if (!key) continue
    referenced.add(key)
    if (key.endsWith('/banner/banner.avif')) {
      referenced.add(key.replace(/banner\.avif$/, 'banner-mini.avif'))
      referenced.add(key.replace(/banner\.avif$/, 'banner-full.avif'))
    }
  }

  for (const image of gallery) {
    for (const url of [image.url, image.thumbnail_url]) {
      const key = url ? extractSubmissionAssetKey(url) : null
      if (key) referenced.add(key)
    }
  }

  return referenced
}

const safeErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown failure'
  return message.replaceAll(/[\r\n\t]+/g, ' ').slice(0, 900)
}

export interface SubmissionOrphanCleanupResult {
  scanned: number
  done: number
  owed: number
  cancelled: number
  bookkeepingFailed: number
}

/**
 * Processes already-persisted jobs. The job is never removed until idempotent
 * S3 deletion and every saved Cloudflare URL are both confirmed. External work
 * intentionally runs outside a Prisma transaction.
 */
export const processSubmissionOrphanCleanupJobs = async (options: {
  limit: number
  objectKeys?: string[]
}): Promise<SubmissionOrphanCleanupResult> => {
  const jobs = await prisma.patch_submission_orphan_cleanup.findMany({
    ...(options.objectKeys?.length
      ? { where: { object_key: { in: [...new Set(options.objectKeys)] } } }
      : {}),
    orderBy: [{ created: 'asc' }, { id: 'asc' }],
    take: options.limit,
    select: {
      id: true,
      object_key: true,
      purge_urls: true,
      attempts: true
    }
  })
  const result: SubmissionOrphanCleanupResult = {
    scanned: jobs.length,
    done: 0,
    owed: 0,
    cancelled: 0,
    bookkeepingFailed: 0
  }
  if (!jobs.length) return result

  const serving = await loadServingSubmissionAssetKeys()

  for (const job of jobs) {
    const storedUrls = parseSubmissionAssetPurgeUrls(job.purge_urls)
    const purgeUrls = mergeUnique(
      storedUrls,
      buildSubmissionAssetPublicUrls([job.object_key])
    )

    // The complete retry credential must be durable before object deletion.
    if (purgeUrls.length !== storedUrls.length) {
      try {
        await prisma.patch_submission_orphan_cleanup.update({
          where: { object_key: job.object_key },
          data: { purge_urls: purgeUrls }
        })
      } catch (error) {
        console.error('Failed to persist submission orphan purge URLs', {
          cleanupId: job.id,
          error
        })
        result.bookkeepingFailed += 1
        continue
      }
    }

    if (serving.has(job.object_key)) {
      try {
        await prisma.patch_submission_orphan_cleanup.delete({
          where: { id: job.id }
        })
        result.cancelled += 1
      } catch (error) {
        console.error('Failed to cancel a referenced submission orphan job', {
          cleanupId: job.id,
          error
        })
        result.bookkeepingFailed += 1
      }
      continue
    }

    let deleteError: unknown = null
    try {
      await deleteFileFromS3(job.object_key)
    } catch (error) {
      deleteError = error
      console.error('Failed to delete a persisted submission orphan', {
        cleanupId: job.id,
        error
      })
    }

    const purgeResult = purgeUrls.length
      ? await purgeCloudflareCache(purgeUrls)
      : { status: 0, success: true }

    if (!deleteError && purgeResult.success) {
      try {
        await prisma.patch_submission_orphan_cleanup.delete({
          where: { id: job.id }
        })
        result.done += 1
      } catch (error) {
        console.error('Failed to remove a completed submission orphan job', {
          cleanupId: job.id,
          error
        })
        result.bookkeepingFailed += 1
      }
      continue
    }

    const reasons = [
      deleteError ? `delete: ${safeErrorMessage(deleteError)}` : null,
      purgeResult.success ? null : `purge: unconfirmed (${purgeResult.status})`
    ].filter((reason): reason is string => Boolean(reason))
    try {
      await prisma.patch_submission_orphan_cleanup.update({
        where: { id: job.id },
        data: {
          attempts: { increment: 1 },
          last_error: reasons.join('; ').slice(0, 1007)
        }
      })
      result.owed += 1
    } catch (error) {
      console.error('Failed to record a submission orphan cleanup attempt', {
        cleanupId: job.id,
        error
      })
      result.bookkeepingFailed += 1
    }
  }

  return result
}

export const processSubmissionOrphanCleanupJobsBestEffort = async (
  objectKeys: string[],
  context: string
) => {
  if (!objectKeys.length) return
  try {
    await processSubmissionOrphanCleanupJobs({
      limit: objectKeys.length,
      objectKeys
    })
  } catch (error) {
    // Enqueueing happens before this helper is called, so a later maintenance
    // apply can retry even when the immediate attempt cannot read the database.
    console.error('Failed to process submission orphan cleanup jobs', {
      context,
      keyCount: objectKeys.length,
      error
    })
  }
}
