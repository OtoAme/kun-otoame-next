import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import {
  PATCH_SUBMISSION_CLEANUP_STATUSES,
  PATCH_SUBMISSION_REVIEW_MIN_ROLE
} from '~/constants/patchSubmission'
import { patchSubmissionDraftPayloadSchema } from '~/validations/patchSubmission'
import {
  buildPatchSubmissionPublishPreview,
  type PatchSubmissionPublishPreview
} from '~/app/api/patch-submission/publishPreview'
import type { PatchSubmissionStatus } from '~/types/api/patchSubmission'

export interface AdminSubmissionRow {
  id: number
  status: PatchSubmissionStatus
  name: string
  authorName: string
  authorId: number
  submittedAt: string | null
  created: string
}

export interface AdminPatchSubmissionDetail {
  id: number
  status: PatchSubmissionStatus
  name: string
  payloadVersion: number
  heldAmount: number
  roleAtCreation: number
  externalSource: string | null
  externalFetchedAt: string | null
  reviewReason: string | null
  reviewedAt: string | null
  reviewedBy: { id: number; name: string } | null
  submittedAt: string | null
  created: string
  author: { id: number; name: string; avatar: string }
  preview: PatchSubmissionPublishPreview | null
}

/**
 * The review queue. Oldest submission first, because a queue ordered any other
 * way lets an entry sit forever. The first release shows only the title, the
 * author and the status: everything else is one click away on the detail page.
 */
export const listAdminPatchSubmissions = async (input: {
  page: number
  limit: number
  status?: PatchSubmissionStatus
  query: string
  reviewerRole: number
}): Promise<{ submissions: AdminSubmissionRow[]; total: number } | string> => {
  if (input.reviewerRole < PATCH_SUBMISSION_REVIEW_MIN_ROLE) {
    return '您没有审核投稿的权限'
  }

  const search = input.query.trim()
  const numeric = Number(search)
  const where: Prisma.patch_submissionWhereInput = {
    status: input.status ?? 'pending',
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
            { vndb_id: search.toLowerCase() },
            { vndb_relation_id: search.toLowerCase() },
            { dlsite_code: search.toUpperCase() },
            ...(Number.isSafeInteger(numeric) && search !== ''
              ? [{ bangumi_id: numeric }, { steam_id: numeric }]
              : [])
          ]
        }
      : {})
  }

  const [rows, total] = await Promise.all([
    prisma.patch_submission.findMany({
      where,
      // Pending work first, then the rest by recency.
      orderBy: [{ submitted_at: 'asc' }, { created: 'asc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: {
        id: true,
        status: true,
        name: true,
        submitted_at: true,
        created: true,
        user: { select: { id: true, name: true } }
      }
    }),
    prisma.patch_submission.count({ where })
  ])

  return {
    total,
    submissions: rows.map((row) => ({
      id: row.id,
      status: row.status as PatchSubmissionStatus,
      name: row.name,
      authorId: row.user.id,
      authorName: row.user.name,
      submittedAt: row.submitted_at?.toISOString() ?? null,
      created: row.created.toISOString()
    }))
  }
}

/** Reviewers see the full frozen payload; they cannot edit it. */
export const getAdminPatchSubmission = async (
  submissionId: number,
  reviewerRole: number
): Promise<AdminPatchSubmissionDetail | string> => {
  if (reviewerRole < PATCH_SUBMISSION_REVIEW_MIN_ROLE) {
    return '您没有审核投稿的权限'
  }

  const row = await prisma.patch_submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      name: true,
      payload: true,
      payload_version: true,
      held_amount: true,
      role_at_creation: true,
      external_source: true,
      external_fetched_at: true,
      review_reason: true,
      reviewed_at: true,
      banner_key: true,
      submitted_at: true,
      created: true,
      user: { select: { id: true, name: true, avatar: true } },
      reviewed_by: { select: { id: true, name: true } },
      gallery: {
        where: { upload_status: 'ready' },
        orderBy: { display_order: 'asc' },
        select: {
          id: true,
          image_key: true,
          thumbnail_key: true,
          is_nsfw: true,
          display_order: true
        }
      }
    }
  })

  if (!row) {
    return '投稿不存在'
  }

  const cleanupOwed = PATCH_SUBMISSION_CLEANUP_STATUSES.includes(
    row.status as (typeof PATCH_SUBMISSION_CLEANUP_STATUSES)[number]
  )
  const payload = patchSubmissionDraftPayloadSchema.safeParse(row.payload)
  const preview = payload.success
    ? await buildPatchSubmissionPublishPreview({
        payload: payload.data,
        bannerKey: cleanupOwed ? null : row.banner_key,
        gallery: cleanupOwed
          ? []
          : row.gallery.flatMap((image) =>
              image.image_key
                ? [
                    {
                      id: image.id,
                      key: image.image_key,
                      thumbnailKey: image.thumbnail_key,
                      isNSFW: image.is_nsfw,
                      displayOrder: image.display_order
                    }
                  ]
                : []
            )
      })
    : null

  return {
    id: row.id,
    status: row.status as PatchSubmissionStatus,
    name: row.name,
    payloadVersion: row.payload_version,
    heldAmount: row.held_amount,
    roleAtCreation: row.role_at_creation,
    externalSource: row.external_source,
    externalFetchedAt: row.external_fetched_at?.toISOString() ?? null,
    reviewReason: row.review_reason,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewedBy: row.reviewed_by,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    created: row.created.toISOString(),
    author: row.user,
    preview
  }
}
