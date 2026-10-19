import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  patch: { findMany: vi.fn(), count: vi.fn() },
  patch_submission: { findMany: vi.fn(), count: vi.fn() }
}))
const quota = vi.hoisted(() => vi.fn())
vi.mock('~/prisma/index', () => ({ prisma: db }))
vi.mock('~/app/api/patch-submission/service', () => ({
  getPatchSubmissionQuota: quota
}))
vi.mock('~/lib/s3', () => ({
  getS3PublicUrl: (key: string) =>
    key ? `https://synthetic.test/${key}` : null
}))
import { getWorkspaceEntries } from '~/app/api/workspace/entries/service'
beforeEach(() => {
  vi.resetAllMocks()
  db.user.findUnique.mockResolvedValue({
    moemoepoint: 20,
    moemoepoint_reserved: 5
  })
  db.patch.findMany.mockResolvedValue([])
  db.patch.count.mockResolvedValue(0)
  db.patch_submission.findMany.mockResolvedValue([])
  db.patch_submission.count.mockResolvedValue(0)
  quota.mockResolvedValue({ activeCount: 1 })
})
describe('workspace entries private database pagination', () => {
  it('applies author, search and status before both paging and count', async () => {
    const result = await getWorkspaceEntries(
      {
        view: 'submissions',
        page: 2,
        limit: 20,
        query: 'game',
        status: 'pending'
      },
      { id: 7, role: 1, name: 'user' }
    )
    const read = db.patch_submission.findMany.mock.calls[0][0]
    expect(read).toMatchObject({
      where: {
        user_id: 7,
        AND: expect.arrayContaining([{ status: 'pending' }])
      },
      skip: 20,
      take: 20
    })
    expect(db.patch_submission.count).toHaveBeenCalledWith({
      where: read.where
    })
    expect(read.select).not.toHaveProperty('payload')
    expect(result.moemoepointBalance).toEqual({
      total: 20,
      reserved: 5,
      available: 15
    })
  })
  it('reads formal patches without private payload and skips quota for role 4', async () => {
    const result = await getWorkspaceEntries(
      { view: 'published', page: 1, limit: 20 },
      { id: 7, role: 4, name: 'user' }
    )
    expect(quota).not.toHaveBeenCalled()
    expect(db.patch_submission.findMany).not.toHaveBeenCalled()
    expect(db.patch.findMany.mock.calls[0][0].where).toEqual({ user_id: 7 })
    expect(result).toMatchObject({ quota: null, canCreateDirect: true })
  })
})
