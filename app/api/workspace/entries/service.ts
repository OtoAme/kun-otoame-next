import type { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { getPatchSubmissionQuota } from '~/app/api/patch-submission/service'
import {
  PATCH_SUBMISSION_ACTIVE_STATUSES,
  PATCH_SUBMISSION_CLEANUP_STATUSES
} from '~/constants/patchSubmission'
import { getS3PublicUrl } from '~/lib/s3'
import { toMoemoepointBalance } from '~/utils/moemoepoint'
import { WORKSPACE_ERRORS } from '~/constants/workspace'
import { ResourceMutationError } from '~/app/api/patch/resource/mutation'
import type {
  WorkspaceEntriesQuery,
  WorkspaceEntriesResponse,
  WorkspaceEntry,
  WorkspaceUser
} from '~/types/api/workspace'
import type { PatchSubmissionStatus } from '~/types/api/patchSubmission'

export const getWorkspaceEntries = async (
  input: WorkspaceEntriesQuery,
  user: WorkspaceUser
): Promise<WorkspaceEntriesResponse> => {
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { moemoepoint: true, moemoepoint_reserved: true }
  })
  if (!account)
    throw new ResourceMutationError(
      WORKSPACE_ERRORS.login_required.message,
      401
    )
  const quota =
    user.role >= 4 ? null : await getPatchSubmissionQuota(user.id, user.role)
  const pagination = { skip: (input.page - 1) * input.limit, take: input.limit }
  let items: WorkspaceEntry[]
  let total: number
  if (input.view === 'published') {
    const where: Prisma.patchWhereInput = {
      user_id: user.id,
      ...(input.query
        ? { name: { contains: input.query, mode: 'insensitive' } }
        : {})
    }
    const [rows, count] = await Promise.all([
      prisma.patch.findMany({
        where,
        ...pagination,
        orderBy: [{ created: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          unique_id: true,
          name: true,
          banner: true,
          status: true,
          created: true
        }
      }),
      prisma.patch.count({ where })
    ])
    total = count
    items = rows.map((row) => ({
      kind: 'published',
      patch: {
        id: row.id,
        uniqueId: row.unique_id,
        name: row.name,
        banner: row.banner,
        status: row.status,
        created: row.created.toISOString()
      }
    }))
  } else {
    const where: Prisma.patch_submissionWhereInput = {
      user_id: user.id,
      AND: [
        { status: { notIn: ['published', 'deleted'] } },
        {
          OR: [
            { status: { in: [...PATCH_SUBMISSION_ACTIVE_STATUSES] } },
            { hidden_by_user: false }
          ]
        },
        ...(input.status && input.status !== 'all'
          ? [{ status: input.status }]
          : []),
        ...(input.query
          ? [{ name: { contains: input.query, mode: 'insensitive' as const } }]
          : [])
      ]
    }
    const [rows, count] = await Promise.all([
      prisma.patch_submission.findMany({
        where,
        ...pagination,
        orderBy: [{ created: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          status: true,
          held_amount: true,
          review_reason: true,
          banner_key: true,
          submitted_at: true,
          created: true,
          updated: true,
          patch: { select: { unique_id: true } }
        }
      }),
      prisma.patch_submission.count({ where })
    ])
    total = count
    items = rows.map((row) => ({
      kind: 'submission',
      submission: {
        id: row.id,
        name: row.name,
        status: row.status as PatchSubmissionStatus,
        heldAmount: row.held_amount,
        reviewReason: row.review_reason,
        bannerUrl: PATCH_SUBMISSION_CLEANUP_STATUSES.some(
          (status) => status === row.status
        )
          ? null
          : getS3PublicUrl(row.banner_key),
        patchUniqueId: row.patch?.unique_id ?? null,
        submittedAt: row.submitted_at?.toISOString() ?? null,
        created: row.created.toISOString(),
        updated: row.updated.toISOString()
      }
    }))
  }
  return {
    items,
    total,
    page: input.page,
    limit: input.limit,
    quota,
    moemoepointBalance: toMoemoepointBalance(account),
    canCreateDirect: user.role >= 4
  }
}
