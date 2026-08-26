import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The order of operations is the contract here, so the transaction client
 * records every call and the assertions read that trace.
 */
const calls: string[] = []

const prismaMocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    patch_submission: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn()
    },
    user_moemoepoint_reservation: { update: vi.fn() }
  }
  return {
    $transaction: vi.fn(
      (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)
    ),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const reserveMoemoepointMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/moemoepoint/service', () => ({
  reserveMoemoepoint: reserveMoemoepointMock
}))

import {
  PatchSubmissionError,
  createPatchSubmissionDraft
} from '~/app/api/patch-submission/quota'
import { PATCH_SUBMISSION_DEPOSIT } from '~/constants/patchSubmission'

const tx = prismaMocks._tx

const payload = {
  name: 'Some game',
  introduction: 'x'.repeat(20),
  vndbId: '',
  vndbRelationId: 'r1',
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
  released: '2026-08-24',
  contentLimit: 'sfw',
  isDuplicate: false
}

const setupUser = (role: number) => {
  tx.$queryRaw.mockImplementation((query: { strings?: string[] }) => {
    const text = Array.isArray(query?.strings) ? query.strings.join('') : ''
    if (text.includes('FOR UPDATE')) {
      calls.push('lockUserRow')
      return Promise.resolve([{ id: 1, role }])
    }
    calls.push('sumBytes')
    return Promise.resolve([{ total: 0n }])
  })
}

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()

  setupUser(1)
  tx.patch_submission.findFirst.mockImplementation(() => {
    calls.push('idempotencyLookup')
    return Promise.resolve(null)
  })
  tx.patch_submission.count.mockImplementation(() => {
    calls.push('countActive')
    return Promise.resolve(0)
  })
  tx.patch_submission.create.mockImplementation(() => {
    calls.push('createSubmission')
    return Promise.resolve({ id: 42, status: 'draft', revision: 1 })
  })
  tx.user_moemoepoint_reservation.update.mockResolvedValue({})
  reserveMoemoepointMock.mockImplementation(() => {
    calls.push('reserve')
    return Promise.resolve({
      reservation: { id: 7 },
      balance: { total: 100, reserved: 10, available: 90 },
      applied: true
    })
  })
})

describe('draft creation ordering', () => {
  it('locks the user row before counting, reserving or inserting', async () => {
    await createPatchSubmissionDraft({
      userId: 1,
      requestId: 'req-1',
      payload
    })

    expect(calls).toEqual([
      'lockUserRow',
      'idempotencyLookup',
      'countActive',
      'sumBytes',
      'reserve',
      'createSubmission'
    ])
  })

  it('runs inside an explicit ReadCommitted transaction', async () => {
    await createPatchSubmissionDraft({
      userId: 1,
      requestId: 'req-1',
      payload
    })

    expect(prismaMocks.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'ReadCommitted' })
    )
  })
})

describe('creation idempotency', () => {
  it('returns the existing draft without counting or reserving again', async () => {
    tx.patch_submission.findFirst.mockImplementation(() => {
      calls.push('idempotencyLookup')
      return Promise.resolve({ id: 42, status: 'draft', revision: 3 })
    })

    const result = await createPatchSubmissionDraft({
      userId: 1,
      requestId: 'req-1',
      payload
    })

    expect(result).toEqual({
      submission: { id: 42, status: 'draft', revision: 3 },
      applied: false
    })
    expect(calls).toEqual(['lockUserRow', 'idempotencyLookup'])
    expect(reserveMoemoepointMock).not.toHaveBeenCalled()
    expect(tx.patch_submission.create).not.toHaveBeenCalled()
  })

  it('keys idempotency per user and request', async () => {
    await createPatchSubmissionDraft({
      userId: 1,
      requestId: 'req-1',
      payload
    })

    expect(reserveMoemoepointMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        idempotencyKey: 'patch_submission:create:1:req-1'
      })
    )
  })
})

describe('quota enforcement', () => {
  it('refuses a regular user past five active drafts', async () => {
    tx.patch_submission.count.mockResolvedValue(
      PATCH_SUBMISSION_DEPOSIT.user.maxActive
    )

    await expect(
      createPatchSubmissionDraft({ userId: 1, requestId: 'r', payload })
    ).rejects.toBeInstanceOf(PatchSubmissionError)
    expect(reserveMoemoepointMock).not.toHaveBeenCalled()
  })

  it('lets a creator go further, and holds the smaller deposit', async () => {
    setupUser(2)
    tx.patch_submission.count.mockResolvedValue(
      PATCH_SUBMISSION_DEPOSIT.user.maxActive
    )

    await createPatchSubmissionDraft({ userId: 1, requestId: 'r', payload })

    expect(reserveMoemoepointMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        amount: PATCH_SUBMISSION_DEPOSIT.creator.amount
      })
    )
  })

  it('freezes the deposit terms on the row', async () => {
    setupUser(2)
    await createPatchSubmissionDraft({ userId: 1, requestId: 'r', payload })

    expect(tx.patch_submission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role_at_creation: 2,
          held_amount: PATCH_SUBMISSION_DEPOSIT.creator.amount
        })
      })
    )
  })

  it('refuses once the byte cap is reached', async () => {
    tx.$queryRaw.mockImplementation((query: { strings?: string[] }) => {
      const text = Array.isArray(query?.strings) ? query.strings.join('') : ''
      if (text.includes('FOR UPDATE')) {
        return Promise.resolve([{ id: 1, role: 1 }])
      }
      return Promise.resolve([{ total: BigInt(500 * 1024 * 1024) }])
    })

    await expect(
      createPatchSubmissionDraft({ userId: 1, requestId: 'r', payload })
    ).rejects.toBeInstanceOf(PatchSubmissionError)
    expect(reserveMoemoepointMock).not.toHaveBeenCalled()
  })

  it('rejects a missing user before doing anything else', async () => {
    tx.$queryRaw.mockResolvedValue([])

    await expect(
      createPatchSubmissionDraft({ userId: 999, requestId: 'r', payload })
    ).rejects.toBeInstanceOf(PatchSubmissionError)
    expect(tx.patch_submission.findFirst).not.toHaveBeenCalled()
  })
})

describe('searchable identity columns', () => {
  it('copies the external ids out of the payload', async () => {
    await createPatchSubmissionDraft({
      userId: 1,
      requestId: 'r',
      payload: { ...payload, bangumiId: '123', steamId: '456' }
    })

    expect(tx.patch_submission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Some game',
          vndb_relation_id: 'r1',
          bangumi_id: 123,
          steam_id: 456,
          vndb_id: null,
          dlsite_code: null
        })
      })
    )
  })
})
