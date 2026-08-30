import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch_submission: {
    findFirst: vi.fn(),
    updateMany: vi.fn()
  },
  patch: { findFirst: vi.fn() },
  user: { findMany: vi.fn() }
}))
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const createMessageMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/utils/message', () => ({
  createMessage: createMessageMock
}))

import {
  submitPatchSubmission,
  withdrawPatchSubmission
} from '~/app/api/patch-submission/submit'

const payload = {
  name: 'Notification game',
  introduction: 'A sufficiently long introduction.',
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

beforeEach(() => {
  vi.clearAllMocks()
  prismaMocks.patch_submission.findFirst.mockResolvedValue({
    status: 'draft',
    payload,
    banner_key: 'patch-submission/1/banner/banner.avif',
    gallery: [],
    user: { name: 'Author' }
  })
  prismaMocks.patch_submission.updateMany.mockResolvedValue({ count: 1 })
  prismaMocks.user.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }])
  createMessageMock.mockResolvedValue({})
})

describe('patch submission reviewer notification', () => {
  it('fans out after the pending transition and isolates recipient failures', async () => {
    createMessageMock
      .mockRejectedValueOnce(new Error('recipient unavailable'))
      .mockResolvedValueOnce({})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(submitPatchSubmission(1, 2)).resolves.toEqual({})

    expect(prismaMocks.patch_submission.updateMany).toHaveBeenCalledBefore(
      prismaMocks.user.findMany
    )
    expect(prismaMocks.user.findMany).toHaveBeenCalledWith({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
    expect(createMessageMock).toHaveBeenCalledTimes(2)
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system',
        recipient_id: 3,
        link: '/admin/submission/1'
      })
    )
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to notify some patch submission reviewers',
      expect.objectContaining({ failed: 1, total: 2 })
    )
  })

  it('does not roll back a successful submission when reviewer lookup fails', async () => {
    prismaMocks.user.findMany.mockRejectedValue(
      new Error('database unavailable')
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(submitPatchSubmission(1, 2)).resolves.toEqual({})

    expect(prismaMocks.patch_submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending' })
      })
    )
    expect(createMessageMock).not.toHaveBeenCalled()
  })
})

describe('patch submission withdrawal notification', () => {
  beforeEach(() => {
    prismaMocks.patch_submission.findFirst.mockResolvedValue({
      status: 'pending',
      name: 'Notification game',
      user: { name: 'Author' }
    })
  })

  it('fans out only after the pending-to-draft transition succeeds', async () => {
    await expect(withdrawPatchSubmission(1, 2)).resolves.toEqual({})

    expect(prismaMocks.patch_submission.updateMany).toHaveBeenCalledBefore(
      prismaMocks.user.findMany
    )
    expect(prismaMocks.user.findMany).toHaveBeenCalledWith({
      where: { role: { gte: 3 } },
      select: { id: true }
    })
    expect(createMessageMock).toHaveBeenCalledTimes(2)
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system',
        content: expect.stringContaining('撤回了游戏条目《Notification game》'),
        sender_id: 2,
        recipient_id: 3,
        link: '/admin/submission/1'
      })
    )
  })

  it('does not notify when the guarded withdrawal loses the race', async () => {
    prismaMocks.patch_submission.updateMany.mockResolvedValue({ count: 0 })

    await expect(withdrawPatchSubmission(1, 2)).resolves.toBeTypeOf('string')

    expect(prismaMocks.user.findMany).not.toHaveBeenCalled()
    expect(createMessageMock).not.toHaveBeenCalled()
  })

  it('does not turn a successful withdrawal into a failure when notifications fail', async () => {
    prismaMocks.user.findMany.mockRejectedValue(
      new Error('reviewer lookup unavailable')
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(withdrawPatchSubmission(1, 2)).resolves.toEqual({})

    expect(prismaMocks.patch_submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'draft' })
      })
    )
    expect(createMessageMock).not.toHaveBeenCalled()
  })

  it('isolates one unavailable reviewer from the successful withdrawal', async () => {
    createMessageMock
      .mockRejectedValueOnce(new Error('recipient unavailable'))
      .mockResolvedValueOnce({})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(withdrawPatchSubmission(1, 2)).resolves.toEqual({})

    expect(createMessageMock).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to notify some patch submission withdrawal reviewers',
      expect.objectContaining({ failed: 1, total: 2 })
    )
  })
})

describe('patch submission VNDB duplicate confirmation', () => {
  const withVndbId = (isDuplicate: boolean) => {
    prismaMocks.patch_submission.findFirst.mockResolvedValue({
      status: 'draft',
      payload: { ...payload, vndbId: 'v19', isDuplicate },
      banner_key: 'patch-submission/1/banner/banner.avif',
      gallery: [],
      user: { name: 'Author' }
    })
  }

  it('blocks an unconfirmed submission whose VNDB ID is already published', async () => {
    withVndbId(false)
    prismaMocks.patch.findFirst.mockResolvedValue({ unique_id: 'abcd1234' })

    await expect(submitPatchSubmission(1, 2)).resolves.toContain('abcd1234')
    expect(prismaMocks.patch_submission.updateMany).not.toHaveBeenCalled()
  })

  it('lets a confirmed duplicate through as a different release', async () => {
    withVndbId(true)
    prismaMocks.patch.findFirst.mockResolvedValue({ unique_id: 'abcd1234' })

    await expect(submitPatchSubmission(1, 2)).resolves.toEqual({})
    expect(prismaMocks.patch_submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending' })
      })
    )
  })

  it('does not query for duplicates when no VNDB ID was given', async () => {
    prismaMocks.patch.findFirst.mockResolvedValue(null)

    await expect(submitPatchSubmission(1, 2)).resolves.toEqual({})
    expect(prismaMocks.patch.findFirst).not.toHaveBeenCalled()
  })
})

describe('patch submission gallery order gate', () => {
  const galleryRow = (uploadStatus: string, displayOrder: number) => ({
    upload_status: uploadStatus,
    display_order: displayOrder
  })

  it('refuses to freeze a submission whose ready rows share a display order', async () => {
    prismaMocks.patch_submission.findFirst.mockResolvedValue({
      status: 'draft',
      payload,
      banner_key: 'patch-submission/1/banner/banner.avif',
      gallery: [galleryRow('ready', 1), galleryRow('ready', 1)],
      user: { name: 'Author' }
    })

    await expect(submitPatchSubmission(1, 2)).resolves.toBe(
      '截图顺序存在冲突, 请返回编辑并重新调整顺序'
    )
    expect(prismaMocks.patch_submission.updateMany).not.toHaveBeenCalled()
  })

  it('allows gaps, which is what a still-local screenshot leaves behind', async () => {
    prismaMocks.patch_submission.findFirst.mockResolvedValue({
      status: 'draft',
      payload,
      banner_key: 'patch-submission/1/banner/banner.avif',
      gallery: [galleryRow('ready', 0), galleryRow('ready', 2)],
      user: { name: 'Author' }
    })

    await expect(submitPatchSubmission(1, 2)).resolves.toEqual({})
  })

  it('ignores failed rows, which never reach the published gallery', async () => {
    prismaMocks.patch_submission.findFirst.mockResolvedValue({
      status: 'draft',
      payload,
      banner_key: 'patch-submission/1/banner/banner.avif',
      gallery: [galleryRow('ready', 0), galleryRow('failed', 0)],
      user: { name: 'Author' }
    })

    await expect(submitPatchSubmission(1, 2)).resolves.toEqual({})
  })
})

describe('patch submission database payload decoding', () => {
  it('refuses damaged JSON before entering review', async () => {
    prismaMocks.patch_submission.findFirst.mockResolvedValue({
      status: 'draft',
      payload: { introduction: 'name is missing' },
      banner_key: 'patch-submission/1/banner/banner.avif',
      gallery: [],
      user: { name: 'Author' }
    })

    await expect(submitPatchSubmission(1, 2)).resolves.toEqual(
      expect.any(String)
    )
    expect(prismaMocks.patch_submission.updateMany).not.toHaveBeenCalled()
    expect(prismaMocks.user.findMany).not.toHaveBeenCalled()
  })
})
