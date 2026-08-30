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
  reviewedAt: string | null
  updated: string
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
  /**
   * Published entries already using this submission's VNDB ID, never including
   * the entry this submission itself became. A shared id can be legitimate for a
   * different release, so the reviewer decides — but they can only decide if
   * they see what it collides with.
   */
  vndbDuplicates: { uniqueId: string; name: string }[]
  /** Whether more entries share the id than the list above shows. */
  duplicatesTruncated: boolean
  /** Whether the author ticked the confirmation to submit despite the above. */
  duplicateConfirmed: boolean
  /**
   * The entry this submission was published as. Null once that entry is deleted,
   * because the link is cleared rather than kept as a dangling id.
   */
  publishedPatch: { uniqueId: string; name: string } | null
}

/**
 * The review queue, always scoped to exactly one status. Pending is a backlog,
 * so it runs oldest first: any other order lets an entry sit forever. Every
 * other status is a history one looks things up in, so it runs newest first.
 * The row shows only the title, the author and one date — everything else is
 * one click away on the detail page.
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

  const status = input.status ?? 'pending'
  const search = input.query.trim()
  const numeric = Number(search)
  const where: Prisma.patch_submissionWhereInput = {
    status,
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

  const orderBy: Prisma.patch_submissionOrderByWithRelationInput[] =
    status === 'pending'
      ? [{ submitted_at: 'asc' }, { id: 'asc' }]
      : // A draft was never reviewed, so it falls through to last-edited first;
        // changes_requested surfaces what was bounced back most recently.
        [
          { reviewed_at: { sort: 'desc', nulls: 'last' } },
          { updated: 'desc' },
          { id: 'desc' }
        ]

  const [rows, total] = await Promise.all([
    prisma.patch_submission.findMany({
      where,
      orderBy,
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: {
        id: true,
        status: true,
        name: true,
        submitted_at: true,
        reviewed_at: true,
        updated: true,
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
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      updated: row.updated.toISOString(),
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
      company_candidates: true,
      held_amount: true,
      role_at_creation: true,
      external_source: true,
      external_fetched_at: true,
      review_reason: true,
      reviewed_at: true,
      banner_key: true,
      banner_original_key: true,
      submitted_at: true,
      created: true,
      patch_id: true,
      user: { select: { id: true, name: true, avatar: true } },
      reviewed_by: { select: { id: true, name: true } },
      patch: { select: { unique_id: true, name: true } },
      gallery: {
        where: { upload_status: 'ready' },
        orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
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
        companyCandidateSnapshots: row.company_candidates,
        includeDiagnostics: true,
        bannerKey: cleanupOwed ? null : row.banner_key,
        bannerOriginalKey: cleanupOwed ? null : row.banner_original_key,
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

  const vndbId = payload.success ? payload.data.vndbId : ''
  const vndbDuplicates = vndbId
    ? await prisma.patch.findMany({
        where: {
          vndb_id: vndbId,
          // The entry this submission became shares the id by construction.
          ...(row.patch_id ? { id: { not: row.patch_id } } : {})
        },
        select: { unique_id: true, name: true },
        orderBy: { id: 'asc' },
        // One past the display limit, because exactly 10 rows does not tell us
        // whether an eleventh exists.
        take: 11
      })
    : []

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
    preview,
    vndbDuplicates: vndbDuplicates.slice(0, 10).map((patch) => ({
      uniqueId: patch.unique_id,
      name: patch.name
    })),
    duplicatesTruncated: vndbDuplicates.length > 10,
    duplicateConfirmed: payload.success ? payload.data.isDuplicate : false,
    publishedPatch: row.patch
      ? { uniqueId: row.patch.unique_id, name: row.patch.name }
      : null
  }
}
