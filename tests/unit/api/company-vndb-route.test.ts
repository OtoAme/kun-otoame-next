import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const parseBodyMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/utils/parseQuery', () => ({
  kunParsePostBody: parseBodyMock
}))

const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))

const prismaMocks = vi.hoisted(() => ({
  patch: { findUnique: vi.fn() },
  patch_company: { findMany: vi.fn() }
}))
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const ensurePatchCompaniesFromVNDBMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/edit/fetchCompanies', () => ({
  ensurePatchCompaniesFromVNDB: ensurePatchCompaniesFromVNDBMock
}))

import { POST } from '~/app/api/patch/introduction/company/vndb/route'

const request = () =>
  new NextRequest(
    'https://www.otoame.top/api/patch/introduction/company/vndb',
    {
      method: 'POST'
    }
  )

describe('manual VNDB company refresh route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyHeaderCookieMock.mockResolvedValue({ uid: 1007 })
    parseBodyMock.mockResolvedValue({ patchId: 10 })
    prismaMocks.patch.findUnique.mockResolvedValue({ vndb_id: 'v123' })
    prismaMocks.patch_company.findMany.mockResolvedValue([])
  })

  it('reports when no company could be resolved', async () => {
    ensurePatchCompaniesFromVNDBMock.mockResolvedValue({
      ensured: 0,
      resolved: 0,
      related: 0
    })

    const response = await POST(request())

    await expect(response.json()).resolves.toBe('未能从 VNDB 获取到会社信息')
  })

  it('distinguishes newly inserted relations from resolved companies', async () => {
    ensurePatchCompaniesFromVNDBMock.mockResolvedValue({
      ensured: 0,
      resolved: 2,
      related: 2
    })

    const response = await POST(request())

    await expect(response.json()).resolves.toEqual({
      message: '成功新增关联 2 个会社',
      companies: []
    })
  })

  it('does not claim a new relation when the patch was already related', async () => {
    ensurePatchCompaniesFromVNDBMock.mockResolvedValue({
      ensured: 0,
      resolved: 2,
      related: 0
    })

    const response = await POST(request())

    await expect(response.json()).resolves.toEqual({
      message: '会社信息已是最新，无需新增关联',
      companies: []
    })
  })
})
