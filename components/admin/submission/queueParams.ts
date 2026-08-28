import {
  PATCH_SUBMISSION_STATUSES,
  type PatchSubmissionStatus
} from '~/types/api/patchSubmission'

/** The queue is a backlog first; every other status is opt-in. */
export const ADMIN_SUBMISSION_QUEUE_DEFAULT_STATUS: PatchSubmissionStatus =
  'pending'

export const ADMIN_SUBMISSION_QUEUE_LIMIT = 50

export interface AdminSubmissionQueueParams {
  query: string
  status: PatchSubmissionStatus
  page: number
}

/**
 * The URL is the only place the queue's state lives, so anything unreadable in
 * it resolves to the default view rather than to an error: a hand-edited or
 * stale link still lands the reviewer somewhere useful.
 */
export const parseAdminSubmissionSearchParams = (searchParams: {
  query?: string
  status?: string
  page?: string
}): AdminSubmissionQueueParams => {
  const status = PATCH_SUBMISSION_STATUSES.find(
    (candidate) => candidate === searchParams.status
  )
  const page = Number(searchParams.page)

  return {
    query: searchParams.query?.trim() ?? '',
    status: status ?? ADMIN_SUBMISSION_QUEUE_DEFAULT_STATUS,
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1
  }
}

/** Defaults are left out, so the plain queue URL stays the plain queue URL. */
export const buildAdminSubmissionQueueUrl = ({
  query,
  status,
  page
}: AdminSubmissionQueueParams) => {
  const params = new URLSearchParams()
  if (status !== ADMIN_SUBMISSION_QUEUE_DEFAULT_STATUS) {
    params.set('status', status)
  }
  if (page > 1) {
    params.set('page', String(page))
  }
  if (query.trim()) {
    params.set('query', query.trim())
  }

  const search = params.toString()
  return search ? `/admin/submission?${search}` : '/admin/submission'
}
