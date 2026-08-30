import { describe, expect, it, vi } from 'vitest'
import { ensureCompanyRelationsByName } from '~/app/api/edit/companyEnsureHelper'

const companyInput = {
  name: 'ＰＡＬＥＴＴＥ',
  introduction: '',
  alias: [],
  primary_language: [],
  official_website: [],
  parent_brand: [],
  user_id: 100
}

const winner = {
  id: 7,
  name: 'Palette',
  alias: [],
  normalized_name: 'palette'
}

const tx = () => ({
  patch_company: {
    findMany: vi.fn(),
    createManyAndReturn: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 })
  },
  patch_company_name_identity: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn()
  },
  $queryRaw: vi.fn().mockResolvedValue([{ company_id: 7 }])
})

describe('legacy company writer Phase B compatibility', () => {
  it('reads the normalized winner after createMany silently skips a unique conflict', async () => {
    const client = tx()
    client.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([winner])
    client.patch_company.createManyAndReturn.mockResolvedValue([])

    const result = await ensureCompanyRelationsByName(
      client as never,
      5,
      new Map([[companyInput.name, companyInput]])
    )

    expect(result).toMatchObject({
      ensured: 0,
      related: 1,
      insertedIds: [7]
    })
    expect(client.$queryRaw).toHaveBeenCalledOnce()
  })

  it('uses normalized winners only after the outer transaction has restarted', async () => {
    const client = tx()
    client.patch_company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([winner])

    const result = await ensureCompanyRelationsByName(
      client as never,
      5,
      new Map([[companyInput.name, companyInput]]),
      'legacy',
      true
    )

    expect(result.related).toBe(1)
    expect(client.patch_company.createManyAndReturn).not.toHaveBeenCalled()
  })
})
