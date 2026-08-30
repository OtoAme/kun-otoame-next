import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addPatchCompanyRelations,
  removePatchCompanyRelations
} from '~/app/api/edit/companyRelationHelper'

const createTx = () => ({
  $queryRaw: vi.fn()
})

describe('company relation helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates add input and returns the relations actually inserted', async () => {
    const tx = createTx()
    tx.$queryRaw.mockResolvedValue([
      { company_id: 5 },
      { company_id: 5 },
      { company_id: 3 }
    ])

    const insertedIds = await addPatchCompanyRelations(
      tx as never,
      1,
      [5, 5, 3, 0, -1, 1.5]
    )

    expect(insertedIds).toEqual([5, 3])
    expect(tx.$queryRaw).toHaveBeenCalledOnce()
  })

  it('keeps add idempotent when relations already exist', async () => {
    const tx = createTx()
    tx.$queryRaw
      .mockResolvedValueOnce([{ company_id: 5 }, { company_id: 3 }])
      .mockResolvedValueOnce([])

    expect(await addPatchCompanyRelations(tx as never, 1, [5, 3])).toEqual([
      5, 3
    ])
    expect(await addPatchCompanyRelations(tx as never, 1, [5, 3])).toEqual([])
  })

  it('returns no changed ids when removing a missing relation', async () => {
    const tx = createTx()
    tx.$queryRaw.mockResolvedValue([])

    const deletedIds = await removePatchCompanyRelations(tx as never, 1, [99])

    expect(deletedIds).toEqual([])
  })

  it('keeps remove idempotent after the first successful delete', async () => {
    const tx = createTx()
    tx.$queryRaw
      .mockResolvedValueOnce([{ company_id: 5 }])
      .mockResolvedValueOnce([])

    expect(await removePatchCompanyRelations(tx as never, 1, [5])).toEqual([5])
    expect(await removePatchCompanyRelations(tx as never, 1, [5])).toEqual([])
  })
})
