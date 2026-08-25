import { prisma } from '~/prisma/index'
import { deleteFileFromS3 } from '~/lib/s3'
import { purgeCloudflareCache } from '~/app/api/utils/purgeCloudflareCache'
import { PATCH_SUBMISSION_CLEANUP_STATUSES } from '~/constants/patchSubmission'
import { buildSubmissionAssetPublicUrls } from './orphanCleanup'

interface SubmissionAssetOwner {
  banner_key: string | null
  banner_thumbnail_key: string | null
  banner_original_key: string | null
  gallery: { image_key: string | null; thumbnail_key: string | null }[]
}

/**
 * Every object a submission owns: the three cover variants plus each gallery
 * image and its thumbnail. Deduplicated, so a key cannot be deleted or counted
 * twice.
 */
export const collectSubmissionAssetKeys = (submission: SubmissionAssetOwner) => [
  ...new Set(
    [
      submission.banner_key,
      submission.banner_thumbnail_key,
      submission.banner_original_key,
      ...submission.gallery.flatMap((image) => [
        image.image_key,
        image.thumbnail_key
      ])
    ].filter((key): key is string => Boolean(key))
  )
]

export interface SubmissionTakedownResult {
  /** Both the object deletion and the CDN purge are confirmed done. */
  completed: boolean
  keyCount: number
  deleteFailures: number
  purgeConfirmed: boolean
}

/**
 * Deletes a submission's objects and purges them from the CDN, reporting whether
 * it finished.
 *
 * Deleting the object is not enough: draft assets are publicly reachable, so an
 * address someone previewed may still be cached at the edge. Order matters —
 * purging before the delete would let the edge re-fetch and re-cache in between.
 *
 * A failed delete does **not** skip the purge. When one image out of twenty
 * fails to delete, the other nineteen are already gone from storage and must
 * still be evicted from the edge, or a violation stays readable through the CDN.
 *
 * purgeCloudflareCache never throws — a missing token or a rejected purge comes
 * back as an unsuccessful result — so completion is judged from that result, not
 * from the absence of an exception.
 */
export const purgeSubmissionAssets = async (
  keys: string[]
): Promise<SubmissionTakedownResult> => {
  if (!keys.length) {
    return {
      completed: true,
      keyCount: 0,
      deleteFailures: 0,
      purgeConfirmed: true
    }
  }

  const deletions = await Promise.all(
    keys.map((key) =>
      deleteFileFromS3(key)
        .then(() => true)
        .catch((error) => {
          console.error('Failed to delete a submission asset', { key, error })
          return false
        })
    )
  )
  const deleteFailures = deletions.filter((deleted) => !deleted).length

  const urls = buildSubmissionAssetPublicUrls(keys)
  if (!urls.length) {
    // Nothing is served through a CDN in this deployment, so the delete above is
    // the whole takedown.
    return {
      completed: deleteFailures === 0,
      keyCount: keys.length,
      deleteFailures,
      purgeConfirmed: true
    }
  }

  const purged = await purgeCloudflareCache(urls)
  if (!purged.success) {
    console.error('Failed to purge submission assets from the CDN', {
      status: purged.status,
      keyCount: keys.length
    })
  }

  return {
    completed: deleteFailures === 0 && purged.success,
    keyCount: keys.length,
    deleteFailures,
    purgeConfirmed: purged.success
  }
}

export type SubmissionTakedownOutcome =
  | ({ status: 'done' } & SubmissionTakedownResult)
  | ({ status: 'owed' } & SubmissionTakedownResult)
  | { status: 'skipped'; reason: 'missing' | 'not-cleanable' }
  | ({ status: 'bookkeeping-failed' } & SubmissionTakedownResult)

/**
 * Takes a terminal submission's assets down and, only once that is confirmed,
 * clears the keys off the row.
 *
 * Keys left on a terminal submission mean "cleanup still owed" — that is the
 * outbox invariant, and it is what lets the cleanup command retry a purge whose
 * object is already gone from storage. The key list is therefore read here from
 * the row rather than accepted from the caller: clearing keys the caller never
 * passed would destroy the very evidence the outbox depends on.
 *
 * The status is also checked here, against the cleanup set rather than the
 * terminal set: `published` is terminal too, but approval handed its objects to
 * the live entry, so taking them down would break a published game. An active
 * submission still needs its assets. Neither may be cleaned no matter who asks.
 *
 * No database transaction is held across the storage calls. Nothing here throws
 * into the caller: by the time this runs the deposit has already been settled.
 */
export const takeDownSubmissionAssets = async (
  submissionId: number
): Promise<SubmissionTakedownOutcome> => {
  let submission
  try {
    submission = await prisma.patch_submission.findUnique({
      where: { id: submissionId },
      select: {
        status: true,
        banner_key: true,
        banner_thumbnail_key: true,
        banner_original_key: true,
        gallery: { select: { image_key: true, thumbnail_key: true } }
      }
    })
  } catch (error) {
    console.error('Failed to load submission asset cleanup state', {
      submissionId,
      error
    })
    return {
      status: 'bookkeeping-failed',
      completed: false,
      keyCount: 0,
      deleteFailures: 0,
      purgeConfirmed: false
    }
  }

  if (!submission) {
    return { status: 'skipped', reason: 'missing' }
  }
  if (
    !PATCH_SUBMISSION_CLEANUP_STATUSES.includes(
      submission.status as (typeof PATCH_SUBMISSION_CLEANUP_STATUSES)[number]
    )
  ) {
    console.error('Refused to take down assets of a submission that still needs them', {
      submissionId,
      status: submission.status
    })
    return { status: 'skipped', reason: 'not-cleanable' }
  }

  const result = await purgeSubmissionAssets(
    collectSubmissionAssetKeys(submission)
  )
  if (!result.completed) {
    console.error(
      'Submission assets were not fully taken down; keys stay on the row for the cleanup command to retry',
      { submissionId, ...result }
    )
    return { status: 'owed', ...result }
  }

  // A submission whose only gallery rows were failed placeholders has no keys at
  // all, and still needs those rows removed.
  try {
    await prisma.$transaction([
      prisma.patch_submission_gallery.deleteMany({
        where: { submission_id: submissionId }
      }),
      prisma.patch_submission.update({
        where: { id: submissionId },
        data: {
          banner_key: null,
          banner_thumbnail_key: null,
          banner_original_key: null
        }
      })
    ])
  } catch (error) {
    console.error('Failed to clear submission asset keys after takedown', {
      submissionId,
      error
    })
    return { status: 'bookkeeping-failed', ...result }
  }

  return { status: 'done', ...result }
}
