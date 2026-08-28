import {
  PATCH_SUBMISSION_LIST_PAGE_MAX,
  PATCH_SUBMISSION_LIST_QUERY_MAX_LENGTH
} from '~/constants/patchSubmission'
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
      PATCH_SUBMISSION_LIST_QUERY_MAX_LENGTH
    ),
    status: status ?? ADMIN_SUBMISSION_QUEUE_DEFAULT_STATUS,
    page:
      Number.isSafeInteger(page) &&
      page >= 1 &&
      page <= PATCH_SUBMISSION_LIST_PAGE_MAX
        ? page
        : 1
  }
}

/**
 * Where the reviewer should stand once the list has answered.
 *
 * Reviewing the last row of the last page shrinks the list under the page the
 * reviewer is standing on, and an out-of-range page reads as an empty status
 * rather than as a page that no longer exists. The total and the row count come
 * from two queries that do not share a transaction, so either signal may already
 * be stale: a total taken before a colleague reviewed the page's last row still
 * claims the page exists. A page past the first that came back empty therefore
 * steps back one page instead of trusting the total, which keeps every redirect
 * strictly decreasing and so bounded by the first page. An empty first page is a
 * status with no submissions, not a page to leave.
 */
export const resolveAdminSubmissionQueuePage = (
  page: number,
  total: number,
  limit: number,
  rowsOnPage: number
) => {
  const lastPage = Math.max(1, Math.ceil(total / limit))

  return rowsOnPage === 0 && page > 1
    ? Math.min(lastPage, page - 1)
    : Math.min(page, lastPage)
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
