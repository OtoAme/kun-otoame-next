import 'dotenv/config'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'

/**
 * Removes submission assets that nothing references any more, and retries the
 * CDN purge that a settlement may have failed to complete.
 *
 * Two rules matter and are not negotiable:
 *
 * 1. An object referenced by a published patch is never touched. Approval does
 *    not move objects, so a submission's assets become the live entry's assets;
 *    deleting them because the submission row was hidden would break the entry.
 * 2. Orphans are only deleted once they are older than the grace period, because
 *    an upload in flight has an object before it has a row.
 */
const SUBMISSION_ASSET_PREFIX = 'patch-submission/'
const DEFAULT_GRACE_HOURS = 24
const DEFAULT_BATCH_SIZE = 200

export interface SubmissionAssetCleanupOptions {
  apply: boolean
  graceHours: number
  limit?: number
}

export interface SubmissionAssetCleanupResult {
  scanned: number
  referenced: number
  withinGrace: number
  orphans: string[]
  deleted: number
  purged: number
}

export const parseSubmissionAssetCleanupOptions = (
  args: string[]
): SubmissionAssetCleanupOptions => {
  const readNumber = (flag: string) => {
    const index = args.indexOf(flag)
    if (index < 0) {
      return undefined
    }
    const value = Number(args[index + 1])
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }

  return {
    apply: args.includes('--apply'),
    graceHours: readNumber('--grace-hours') ?? DEFAULT_GRACE_HOURS,
    limit: readNumber('--limit')
  }
}

export interface SubmissionAssetCleanupDependencies {
  listKeys: () => Promise<{ key: string; lastModified?: Date }[]>
  /** Every key still referenced, by a submission row or a published patch. */
  loadReferencedKeys: () => Promise<Set<string>>
  deleteObject: (key: string) => Promise<void>
  purge: (urls: string[]) => Promise<void>
  close: () => Promise<void>
}

export const runSubmissionAssetCleanup = async (
  options: SubmissionAssetCleanupOptions,
  dependencies: SubmissionAssetCleanupDependencies
): Promise<SubmissionAssetCleanupResult> => {
  const [objects, referenced] = await Promise.all([
    dependencies.listKeys(),
    dependencies.loadReferencedKeys()
  ])

  const graceCutoff = Date.now() - options.graceHours * 60 * 60 * 1000
  const result: SubmissionAssetCleanupResult = {
    scanned: objects.length,
    referenced: 0,
    withinGrace: 0,
    orphans: [],
    deleted: 0,
    purged: 0
  }

  for (const object of objects) {
    if (referenced.has(object.key)) {
      result.referenced += 1
      continue
    }
    if (object.lastModified && object.lastModified.getTime() > graceCutoff) {
      result.withinGrace += 1
      continue
    }
    result.orphans.push(object.key)
    if (options.limit && result.orphans.length >= options.limit) {
      break
    }
  }

  if (!options.apply || !result.orphans.length) {
    return result
  }

  for (const key of result.orphans) {
    await dependencies.deleteObject(key)
    result.deleted += 1
  }

  const imageBedUrl = process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL
  if (imageBedUrl) {
    for (let at = 0; at < result.orphans.length; at += 30) {
      const batch = result.orphans.slice(at, at + 30)
      await dependencies.purge(batch.map((key) => `${imageBedUrl}/${key}`))
      result.purged += batch.length
    }
  }

  return result
}

export const printSubmissionAssetCleanupSummary = (
  options: SubmissionAssetCleanupOptions,
  result: SubmissionAssetCleanupResult
) => {
  console.log(
    [
      `scanned=${result.scanned}`,
      `referenced=${result.referenced}`,
      `within-grace=${result.withinGrace}`,
      `orphans=${result.orphans.length}`,
      options.apply ? `deleted=${result.deleted}` : 'deleted=0 (dry-run)',
      options.apply ? `purged=${result.purged}` : 'purged=0 (dry-run)'
    ].join(' ')
  )

  for (const key of result.orphans.slice(0, 20)) {
    console.log(`  orphan ${key}`)
  }
  if (result.orphans.length > 20) {
    console.log(`  ... and ${result.orphans.length - 20} more`)
  }
}

export const createSubmissionAssetCleanupDependencies =
  async (): Promise<SubmissionAssetCleanupDependencies> => {
    const { s3, deleteFileFromS3 } = await import('~/lib/s3')
    const { prisma } = await import('~/prisma/index')
    const { purgeCloudflareCache } = await import(
      '~/app/api/utils/purgeCloudflareCache'
    )

    return {
      listKeys: async () => {
        const keys: { key: string; lastModified?: Date }[] = []
        let token: string | undefined

        do {
          const response = await s3.send(
            new ListObjectsV2Command({
              Bucket: process.env.KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME!,
              Prefix: SUBMISSION_ASSET_PREFIX,
              ContinuationToken: token,
              MaxKeys: DEFAULT_BATCH_SIZE
            })
          )
          for (const object of response.Contents ?? []) {
            if (object.Key) {
              keys.push({ key: object.Key, lastModified: object.LastModified })
            }
          }
          token = response.NextContinuationToken
        } while (token)

        return keys
      },

      loadReferencedKeys: async () => {
        const referenced = new Set<string>()

        const submissions = await prisma.patch_submission.findMany({
          select: {
            banner_key: true,
            banner_thumbnail_key: true,
            banner_original_key: true,
            gallery: { select: { image_key: true, thumbnail_key: true } }
          }
        })
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
            if (key) {
              referenced.add(key)
            }
          }
        }

        // Approved submissions handed their objects to the live entry, so the
        // patch rows are the authority on what must survive even after the
        // submission row is gone.
        const imageBedUrl = process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL ?? ''
        const publicUrl =
          process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL ?? ''
        const toKey = (url: string) => {
          for (const base of [imageBedUrl, publicUrl]) {
            if (base && url.startsWith(`${base}/`)) {
              return url.slice(base.length + 1)
            }
          }
          return null
        }

        const patches = await prisma.patch.findMany({
          where: { banner: { contains: SUBMISSION_ASSET_PREFIX } },
          select: { banner: true }
        })
        for (const patch of patches) {
          const key = toKey(patch.banner)
          if (key) {
            referenced.add(key)
            // The published cover is one object per variant, and only the base
            // key is stored.
            referenced.add(key.replace(/banner\.avif$/, 'banner-mini.avif'))
            referenced.add(key.replace(/banner\.avif$/, 'banner-full.avif'))
          }
        }

        const images = await prisma.patch_game_image.findMany({
          where: { url: { contains: SUBMISSION_ASSET_PREFIX } },
          select: { url: true, thumbnail_url: true }
        })
        for (const image of images) {
          for (const url of [image.url, image.thumbnail_url]) {
            const key = url ? toKey(url) : null
            if (key) {
              referenced.add(key)
            }
          }
        }

        return referenced
      },

      deleteObject: (key) => deleteFileFromS3(key),
      purge: async (urls) => {
        await purgeCloudflareCache(urls)
      },
      close: async () => {
        const { prisma } = await import('~/prisma/index')
        await prisma.$disconnect()
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
  const options = parseSubmissionAssetCleanupOptions(process.argv.slice(2))
  let dependencies: SubmissionAssetCleanupDependencies | undefined

  createSubmissionAssetCleanupDependencies()
    .then(async (created) => {
      dependencies = created
      console.log(
        `Running submission asset cleanup in ${
          options.apply ? 'apply' : 'dry-run'
        } mode with graceHours=${options.graceHours}, limit=${
          options.limit ?? 'all'
        }.`
      )
      const result = await runSubmissionAssetCleanup(options, dependencies)
      printSubmissionAssetCleanupSummary(options, result)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      await dependencies?.close()
    })
}
