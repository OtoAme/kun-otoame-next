import { describe, expect, it } from 'vitest'
import {
  buildAdminSubmissionQueueUrl,
  parseAdminSubmissionSearchParams
} from '~/components/admin/submission/queueParams'
import { PATCH_SUBMISSION_STATUSES } from '~/types/api/patchSubmission'

const parseUrl = (url: string) => {
  const search = new URL(url, 'http://localhost').searchParams
  return parseAdminSubmissionSearchParams({
    query: search.get('query') ?? undefined,
    status: search.get('status') ?? undefined,
    page: search.get('page') ?? undefined
  })
}

describe('parseAdminSubmissionSearchParams', () => {
  it('opens on the pending backlog when the URL says nothing', () => {
    expect(parseAdminSubmissionSearchParams({})).toEqual({
      query: '',
      status: 'pending',
      page: 1
    })
  })

  it.each(PATCH_SUBMISSION_STATUSES)('keeps the real status %s', (status) => {
    expect(parseAdminSubmissionSearchParams({ status }).status).toBe(status)
  })

  it.each(['approved', 'PENDING', '', 'draft '])(
    'falls back to pending for the unusable status %j',
    (status) => {
      expect(parseAdminSubmissionSearchParams({ status }).status).toBe(
        'pending'
      )
    }
  )

  it.each(['0', '-3', '1.5', 'two', '', ' '])(
    'falls back to page 1 for %j',
    (page) => {
      expect(parseAdminSubmissionSearchParams({ page }).page).toBe(1)
    }
  )

  it('keeps a page the reviewer can actually be on', () => {
    expect(parseAdminSubmissionSearchParams({ page: '7' }).page).toBe(7)
  })

  it('trims the query, so a stray space is not a different search', () => {
    expect(parseAdminSubmissionSearchParams({ query: '  fate  ' }).query).toBe(
      'fate'
    )
  })
})

describe('buildAdminSubmissionQueueUrl', () => {
  it('leaves the defaults out of the plain queue URL', () => {
    expect(
      buildAdminSubmissionQueueUrl({ query: '', status: 'pending', page: 1 })
    ).toBe('/admin/submission')
  })

  it('carries status, page and query together', () => {
    const url = buildAdminSubmissionQueueUrl({
      query: 'fate',
      status: 'rejected',
      page: 3
    })

    expect(url).toBe('/admin/submission?status=rejected&page=3&query=fate')
  })

  it('escapes a query that would otherwise break the URL', () => {
    const params = {
      query: 'a&b=c 中文',
      status: 'published',
      page: 1
    } as const

    expect(parseUrl(buildAdminSubmissionQueueUrl(params))).toEqual(params)
  })

  it.each([
    { query: '', status: 'pending', page: 1 },
    { query: '', status: 'draft', page: 1 },
    { query: 'fate', status: 'pending', page: 4 },
    { query: 'fate stay', status: 'violation', page: 12 }
  ] as const)('round-trips %j through the URL', (params) => {
    expect(parseUrl(buildAdminSubmissionQueueUrl(params))).toEqual(params)
  })

  it('round-trips the trimmed query rather than the raw one', () => {
    expect(
      parseUrl(
        buildAdminSubmissionQueueUrl({
          query: '  fate  ',
          status: 'deleted',
          page: 2
        })
      )
    ).toEqual({ query: 'fate', status: 'deleted', page: 2 })
  })
})
