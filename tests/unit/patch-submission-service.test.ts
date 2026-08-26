import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch_submission: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn()
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
import { getAdminPatchSubmission } from '~/app/api/admin/patch-submission/service'

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
