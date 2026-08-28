import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch_submission: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn()
  },
  patch: {
    findMany: vi.fn()
  }
}))
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

vi.mock('~/lib/s3', () => ({
  getS3PublicUrl: (key: string | null) =>
    key ? `https://cdn.example.test/${key}` : null
}))

import {
  getPatchSubmission,
  getPatchSubmissionPublishPreview,
  updatePatchSubmissionDraft
} from '~/app/api/patch-submission/service'
import {
  getAdminPatchSubmission,
  listAdminPatchSubmissions
} from '~/app/api/admin/patch-submission/service'
import type { PatchSubmissionStatus } from '~/types/api/patchSubmission'

const payload = {
  name: 'Test',
  introduction: '',
  vndbId: '',
  vndbRelationId: '',
  bangumiId: '',
  steamId: '',
  dlsiteCode: '',
  dlsiteCircleName: '',
  dlsiteCircleLink: '',
  vndbTags: [],
  vndbDevelopers: [],
  bangumiTags: [],
  bangumiDevelopers: [],
  steamTags: [],
  steamDevelopers: [],
  steamAliases: [],
  officialUrl: '',
  alias: [],
  tag: [],
  released: '',
  contentLimit: 'sfw',
  isDuplicate: false
}

const row = (status: string) => ({
  id: 1,
  status,
  payload,
  payload_version: 1,
  revision: 2,
  held_amount: 10,
  role_at_creation: 1,
  review_reason: 'reason',
  reviewed_at: new Date('2026-08-25T00:00:00.000Z'),
  external_source: null,
  external_fetched_at: null,
  banner_key: 'patch-submission/1-secret/banner/banner.avif',
  submitted_at: new Date('2026-08-24T00:00:00.000Z'),
  created: new Date('2026-08-23T00:00:00.000Z'),
  updated: new Date('2026-08-25T00:00:00.000Z'),
  patch: { unique_id: 'ABCDEFGH' },
  gallery: [
    {
      id: 9,
      client_asset_id: 'asset-9',
      upload_status: 'ready',
      image_key: 'patch-submission/1-secret/gallery/9.avif',
      thumbnail_key: 'patch-submission/1-secret/gallery/thumb-9.avif',
      is_nsfw: true,
      display_order: 0
    }
  ]
})

const adminRow = (status: string) => ({
  ...row(status),
  name: 'Test',
  patch_id: null,
  patch: null,
  user: { id: 2, name: 'author', avatar: 'avatar' },
  reviewed_by: { id: 3, name: 'reviewer' }
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://published.example.test'
})

describe('patch submission asset visibility', () => {
  it.each(['rejected', 'violation', 'deleted'])(
    'does not expose cleanup outbox keys to the author for %s',
    async (status) => {
      prismaMocks.patch_submission.findFirst.mockResolvedValue(row(status))

      const submission = await getPatchSubmission(1, 2)

      expect(submission).not.toBeTypeOf('string')
      expect(submission).toMatchObject({ bannerUrl: null, gallery: [] })
    }
  )

  it('still exposes published assets because its keys are provenance, not cleanup outbox', async () => {
    prismaMocks.patch_submission.findFirst.mockResolvedValue(row('published'))

    const submission = await getPatchSubmission(1, 2)

    expect(submission).not.toBeTypeOf('string')
    expect(submission).toMatchObject({
      bannerUrl:
        'https://cdn.example.test/patch-submission/1-secret/banner/banner.avif'
    })
    expect(
      typeof submission === 'string' ? [] : submission.gallery
    ).toHaveLength(1)
  })

  it('does not hand cleanup outbox material to the admin detail renderer', async () => {
    prismaMocks.patch_submission.findUnique.mockResolvedValue(
      adminRow('violation')
    )

    const submission = await getAdminPatchSubmission(1, 3)

    expect(submission).not.toBeTypeOf('string')
    expect(submission).toMatchObject({
      preview: { bannerUrl: null, gallery: [] }
    })
  })

  it('builds the author preview from owned ready assets without exposing keys', async () => {
    prismaMocks.patch_submission.findFirst.mockResolvedValue(row('draft'))

    const preview = await getPatchSubmissionPublishPreview(1, 2)

    expect(prismaMocks.patch_submission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, user_id: 2 } })
    )
    expect(preview).toMatchObject({
      bannerUrl:
        'https://published.example.test/patch-submission/1-secret/banner/banner.avif',
      gallery: [
        {
          imageUrl:
            'https://published.example.test/patch-submission/1-secret/gallery/9.avif'
        }
      ]
    })
    expect(JSON.stringify(preview)).not.toContain('image_key')
  })

  it('persists the actual external fetch time instead of refreshing it on autosave', async () => {
    const fetchedAt = '2026-08-25T06:00:00.000Z'
    prismaMocks.patch_submission.findFirst.mockResolvedValue({
      status: 'draft',
      revision: 2
    })
    prismaMocks.patch_submission.updateMany.mockResolvedValue({ count: 1 })

    await updatePatchSubmissionDraft({
      submissionId: 1,
      userId: 2,
      revision: 2,
      payload,
      externalSource: 'bangumi',
      externalFetchedAt: fetchedAt
    })

    expect(prismaMocks.patch_submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          external_source: 'bangumi',
          external_fetched_at: new Date(fetchedAt)
        })
      })
    )
  })
})

describe('admin submission queue ordering', () => {
  const listOrderBy = async (status?: PatchSubmissionStatus) => {
    prismaMocks.patch_submission.findMany.mockResolvedValue([])
    prismaMocks.patch_submission.count.mockResolvedValue(0)

    const result = await listAdminPatchSubmissions({
      page: 1,
      limit: 50,
      status,
      query: '',
      reviewerRole: 3
    })
    expect(result).not.toBeTypeOf('string')

    return prismaMocks.patch_submission.findMany.mock.calls.at(-1)?.[0].orderBy
  }

  const oldestFirst = [{ submitted_at: 'asc' }, { id: 'asc' }]
  const newestDecisionFirst = [
    { reviewed_at: { sort: 'desc', nulls: 'last' } },
    { updated: 'desc' },
    { id: 'desc' }
  ]

  it('works the pending backlog oldest first', async () => {
    expect(await listOrderBy('pending')).toEqual(oldestFirst)
  })

  it('opens on that same backlog when no status was asked for', async () => {
    expect(await listOrderBy()).toEqual(oldestFirst)
  })

  it.each(['rejected', 'published', 'violation', 'deleted'] as const)(
    'reads %s as history, most recently decided first',
    async (status) => {
      expect(await listOrderBy(status)).toEqual(newestDecisionFirst)
    }
  )

  it.each(['draft', 'changes_requested'] as const)(
    'falls %s back to last-edited first, because it has no review date',
    async (status) => {
      expect(await listOrderBy(status)).toEqual(newestDecisionFirst)
    }
  )
})

describe('admin submission vndb duplicates', () => {
  const duplicates = (count: number) =>
    Array.from({ length: count }, (_unused, index) => ({
      unique_id: `dup${index}`,
      name: `Duplicate ${index}`
    }))

  const loadDetail = async (
    overrides: Record<string, unknown>,
    found: { unique_id: string; name: string }[]
  ) => {
    prismaMocks.patch_submission.findUnique.mockResolvedValue({
      ...adminRow('pending'),
      payload: { ...payload, vndbId: 'v123' },
      ...overrides
    })
    prismaMocks.patch.findMany.mockResolvedValue(found)

    const submission = await getAdminPatchSubmission(1, 3)
    if (typeof submission === 'string') {
      throw new Error(submission)
    }
    return submission
  }

  it('excludes the entry this submission itself became', async () => {
    const submission = await loadDetail(
      {
        status: 'published',
        patch_id: 42,
        patch: { unique_id: 'PUBLISHD', name: 'Published entry' }
      },
      duplicates(1)
    )

    expect(prismaMocks.patch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vndb_id: 'v123', id: { not: 42 } }
      })
    )
    expect(submission.publishedPatch).toEqual({
      uniqueId: 'PUBLISHD',
      name: 'Published entry'
    })
  })

  it('has nothing to exclude while the submission is still pending', async () => {
    const submission = await loadDetail({}, duplicates(1))

    expect(prismaMocks.patch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vndb_id: 'v123' } })
    )
    expect(submission.publishedPatch).toBeNull()
  })

  it('marks the list truncated only once an eleventh entry exists', async () => {
    const truncated = await loadDetail({}, duplicates(11))

    expect(truncated.vndbDuplicates).toHaveLength(10)
    expect(truncated.duplicatesTruncated).toBe(true)

    const complete = await loadDetail({}, duplicates(10))

    expect(complete.vndbDuplicates).toHaveLength(10)
    expect(complete.duplicatesTruncated).toBe(false)
  })

  it('reports no published entry once that entry was deleted', async () => {
    const submission = await loadDetail(
      { status: 'published', patch_id: null, patch: null },
      duplicates(1)
    )

    expect(submission.publishedPatch).toBeNull()
  })
})
