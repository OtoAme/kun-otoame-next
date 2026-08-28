import { describe, expect, it } from 'vitest'
import {
  buildAdminSubmissionQueueUrl,
  parseAdminSubmissionSearchParams,
  resolveAdminSubmissionQueuePage
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

  it('cuts the query down to what the list API will accept', () => {
    const query = 'あ'.repeat(200)

    expect(parseAdminSubmissionSearchParams({ query }).query).toBe(
      query.slice(0, 107)
    )
  })

  it('rejects a page beyond what the list API will accept', () => {
    expect(parseAdminSubmissionSearchParams({ page: '10000' }).page).toBe(1)
    expect(parseAdminSubmissionSearchParams({ page: '9999' }).page).toBe(9999)
  })

  it('reads the first value when a key is repeated in the URL', () => {
    expect(
      parseAdminSubmissionSearchParams({
        query: ['  fate  ', 'other'],
        status: ['rejected', 'draft'],
        page: ['3', '9']
      })
    ).toEqual({ query: 'fate', status: 'rejected', page: 3 })
  })

  it('falls back to the default view when the repeated values are unusable', () => {
    expect(
      parseAdminSubmissionSearchParams({
        query: [],
        status: ['approved', 'draft'],
        page: ['two', '9']
      })
    ).toEqual({ query: '', status: 'pending', page: 1 })
  })
})

describe('resolveAdminSubmissionQueuePage', () => {
  it('keeps a page that still has rows on it', () => {
    expect(resolveAdminSubmissionQueuePage(2, 51, 50, 1)).toBe(2)
  })

  it('keeps the last page when the rows fill it exactly', () => {
    expect(resolveAdminSubmissionQueuePage(2, 100, 50, 50)).toBe(2)
  })

  it('pulls a page that outran the list back to the last one with rows', () => {
    expect(resolveAdminSubmissionQueuePage(2, 50, 50, 50)).toBe(1)
    expect(resolveAdminSubmissionQueuePage(9, 120, 50, 20)).toBe(3)
  })

  it('lands on the first page when the total says the status is empty', () => {
    expect(resolveAdminSubmissionQueuePage(4, 0, 50, 1)).toBe(1)
  })

  it('steps back when the total still claims a page the rows no longer fill', () => {
    expect(resolveAdminSubmissionQueuePage(2, 51, 50, 0)).toBe(1)
  })

  it('steps back to the last page the total allows when it is stale by more', () => {
    expect(resolveAdminSubmissionQueuePage(7, 170, 50, 0)).toBe(4)
  })

  it('stays on the first page, so an empty status is not a redirect loop', () => {
    expect(resolveAdminSubmissionQueuePage(1, 0, 50, 0)).toBe(1)
  })

  it('leaves ordinary paging through a long list alone', () => {
    expect(resolveAdminSubmissionQueuePage(2, 120, 50, 50)).toBe(2)
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
