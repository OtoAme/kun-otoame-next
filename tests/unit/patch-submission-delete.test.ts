import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    patch_submission: { update: vi.fn() }
  }
  return {
    $transaction: vi.fn(
      (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)
    ),
    _tx: tx
  }
})
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const releaseMoemoepointMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/moemoepoint/service', () => ({
  releaseMoemoepoint: releaseMoemoepointMock
}))

const takeDownSubmissionAssetsMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch-submission/assetCleanup', () => ({
  takeDownSubmissionAssets: takeDownSubmissionAssetsMock
}))

import { deletePatchSubmissionDraft } from '~/app/api/patch-submission/service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMocks._tx.$queryRaw.mockResolvedValue([
    { id: 7, status: 'draft', reservation_id: 11 }
  ])
  prismaMocks._tx.patch_submission.update.mockResolvedValue({})
  releaseMoemoepointMock.mockResolvedValue({
    balance: { total: 100, reserved: 0, available: 100 }
  })
  takeDownSubmissionAssetsMock.mockResolvedValue({
    status: 'owed',
    completed: false,
    keyCount: 2,
    deleteFailures: 0,
    purgeConfirmed: false
  })
})

describe('deletePatchSubmissionDraft', () => {
  it('settles and marks deleted before starting the database-scoped takedown', async () => {
    const result = await deletePatchSubmissionDraft(7, 3)

    expect(prismaMocks._tx.patch_submission.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'deleted', settled_at: expect.any(Date) }
    })
    expect(takeDownSubmissionAssetsMock).toHaveBeenCalledWith(7)
    expect(result).toEqual({
      balance: { total: 100, reserved: 0, available: 100 }
    })
    expect(
      prismaMocks._tx.patch_submission.update.mock.invocationCallOrder[0]
    ).toBeLessThan(takeDownSubmissionAssetsMock.mock.invocationCallOrder[0])
  })

  it('does not undo the completed settlement when cleanup remains owed', async () => {
    await expect(deletePatchSubmissionDraft(7, 3)).resolves.toEqual({
      balance: { total: 100, reserved: 0, available: 100 }
    })
  })
})
