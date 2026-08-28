import {
  PATCH_SUBMISSION_STATUSES,
  type PatchSubmissionStatus
} from '~/types/api/patchSubmission'

/** The queue is a backlog first; every other status is opt-in. */
export const ADMIN_SUBMISSION_QUEUE_DEFAULT_STATUS: PatchSubmissionStatus =
  'pending'

export const ADMIN_SUBMISSION_QUEUE_LIMIT = 50

/** Both bounds mirror patchSubmissionAdminListSchema, the API's own reading. */
const ADMIN_SUBMISSION_QUEUE_QUERY_MAX = 107
const ADMIN_SUBMISSION_QUEUE_PAGE_MAX = 9999

export interface AdminSubmissionQueueParams {
  query: string
  status: PatchSubmissionStatus
  page: number
}

/** A repeated key arrives as an array; the first value is the one that counts. */
const firstValue = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value

/**
 * The URL is the only place the queue's state lives, so anything unreadable in
 * it resolves to the default view rather than to an error: a hand-edited or
 * stale link still lands the reviewer somewhere useful.
 */
export const parseAdminSubmissionSearchParams = (searchParams: {
  query?: string | string[]
  status?: string | string[]
  page?: string | string[]
}): AdminSubmissionQueueParams => {
  const status = PATCH_SUBMISSION_STATUSES.find(
    (candidate) => candidate === firstValue(searchParams.status)
  )
  const page = Number(firstValue(searchParams.page))

  return {
    query: (firstValue(searchParams.query)?.trim() ?? '').slice(
      0,
      ADMIN_SUBMISSION_QUEUE_QUERY_MAX
    ),
    status: status ?? ADMIN_SUBMISSION_QUEUE_DEFAULT_STATUS,
    page:
      Number.isSafeInteger(page) &&
      page >= 1 &&
      page <= ADMIN_SUBMISSION_QUEUE_PAGE_MAX
        ? page
        : 1
  }
}

/**
 * Reviewing the last row of the last page shrinks the list under the page the
 * reviewer is standing on, and an out-of-range page reads as an empty status
 * rather than as a page that no longer exists. Snap back to the last page that
 * still holds rows; an empty status snaps to the first.
 */
export const clampAdminSubmissionQueuePage = (
  page: number,
  total: number,
  limit: number
) => Math.min(page, Math.max(1, Math.ceil(total / limit)))

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
