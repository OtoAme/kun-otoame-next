import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addPatchCompanyRelations,
  removePatchCompanyRelations
} from '~/app/api/edit/companyRelationHelper'

const createTx = () => ({
  $queryRaw: vi.fn(),
  patch_company: {
    updateMany: vi.fn()
  }
})

describe('company relation helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates add input and increments each inserted company once', async () => {
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
    expect(tx.patch_company.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [5, 3] } },
      data: { count: { increment: 1 } }
    })
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

    expect(tx.patch_company.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.patch_company.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [5, 3] } },
      data: { count: { increment: 1 } }
    })
  })

  it('does not decrement count when removing a missing relation', async () => {
    const tx = createTx()
    tx.$queryRaw.mockResolvedValue([])

    const deletedIds = await removePatchCompanyRelations(tx as never, 1, [99])

    expect(deletedIds).toEqual([])
    expect(tx.patch_company.updateMany).not.toHaveBeenCalled()
  })

  it('keeps remove idempotent after the first successful delete', async () => {
    const tx = createTx()
    tx.$queryRaw
      .mockResolvedValueOnce([{ company_id: 5 }])
      .mockResolvedValueOnce([])

    expect(await removePatchCompanyRelations(tx as never, 1, [5])).toEqual([5])
    expect(await removePatchCompanyRelations(tx as never, 1, [5])).toEqual([])

    expect(tx.patch_company.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.patch_company.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [5] } },
      data: { count: { increment: -1 } }
    })
  })
})
