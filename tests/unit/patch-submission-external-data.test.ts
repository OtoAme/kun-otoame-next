import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const database = vi.hoisted(() => ({
  row: {
    id: 12,
    user_id: 7,
    status: 'draft',
    company_candidates: null as unknown
  }
}))

const prismaMocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(async () => [{ ...database.row }]),
    patch_submission: {
      update: vi.fn(async (args: { data: { company_candidates: unknown } }) => {
        database.row.company_candidates = args.data.company_candidates
        return {}
      })
    }
  }
  return {
    patch_submission: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    _tx: tx
  }
})
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

const authMock = vi.hoisted(() => vi.fn())
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: authMock
}))

const rateLimitMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch-submission/rateLimit', () => ({
  checkPatchSubmissionRateLimit: rateLimitMock
}))

const fetchMocks = vi.hoisted(() => ({
  vndb: vi.fn(),
  bangumi: vi.fn(),
  steam: vi.fn(),
  dlsite: vi.fn()
}))
vi.mock('~/app/api/edit/vndb/details/service', () => ({
  fetchVndbDetailsData: fetchMocks.vndb
}))
vi.mock('~/app/api/edit/bangumi/service', () => ({
  fetchBangumiDetailsData: fetchMocks.bangumi
}))
vi.mock('~/app/api/edit/steam/service', () => ({
  fetchSteamDetailsData: fetchMocks.steam
}))
vi.mock('~/app/api/edit/dlsite', () => ({
  fetchDlsiteData: fetchMocks.dlsite
}))

import { POST } from '~/app/api/patch-submission/[id]/external-data/route'
import { savePatchSubmissionCompanyCandidateSnapshot } from '~/app/api/patch-submission/externalData'

const request = (body: unknown) =>
  new NextRequest(
    'https://example.test/api/patch-submission/12/external-data',
    { method: 'POST', body: JSON.stringify(body) }
  )

const callRoute = (body: unknown) =>
  POST(request(body), { params: Promise.resolve({ id: '12' }) })

const vndbData = {
  titles: ['Game'],
  released: '2026-08-30',
  tags: [],
  developers: ['Studio'],
  producers: [
    {
      id: 'p1',
      name: 'Studio',
      original: 'スタジオ',
      aliases: ['Studio Alias'],
      lang: 'ja',
      type: 'co',
      extlinks: [{ url: 'https://studio.example.test' }]
    }
  ]
}

const bangumiData = {
  name: 'Game',
  nameCn: '游戏',
  summary: 'Summary',
  tags: [],
  developers: ['Publisher'],
  companyReferences: [{ name: 'Publisher', sourceRole: '发行' }]
}

const steamData = {
  name: 'Game',
  aliases: {},
  releaseDate: '2026-08-30',
  tags: [],
  developers: [
    { name: 'Porting Studio', link: 'https://store.steampowered.com' }
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  database.row = {
    id: 12,
    user_id: 7,
    status: 'draft',
    company_candidates: null
  }
  let tail = Promise.resolve<unknown>(undefined)
  prismaMocks.$transaction.mockImplementation(
    (callback: (tx: typeof prismaMocks._tx) => Promise<unknown>) => {
      const current = tail.then(() => callback(prismaMocks._tx))
      tail = current.catch(() => undefined)
      return current
    }
  )
  prismaMocks.patch_submission.findFirst.mockResolvedValue({ status: 'draft' })
  authMock.mockResolvedValue({ uid: 7, role: 1 })
  rateLimitMock.mockResolvedValue(null)
  fetchMocks.vndb.mockResolvedValue(vndbData)
  fetchMocks.bangumi.mockResolvedValue(bangumiData)
  fetchMocks.steam.mockResolvedValue(steamData)
})

describe('patch submission external data route', () => {
  it('authenticates and authorizes before consuming quota or calling upstream', async () => {
    authMock.mockResolvedValueOnce(null)
    await expect(
      (await callRoute({ source: 'vndb', lookupId: 'v123' })).json()
    ).resolves.toBe('用户未登录')
    expect(prismaMocks.patch_submission.findFirst).not.toHaveBeenCalled()
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(fetchMocks.vndb).not.toHaveBeenCalled()

    authMock.mockResolvedValueOnce({ uid: 8, role: 1 })
    prismaMocks.patch_submission.findFirst.mockResolvedValueOnce(null)
    await expect(
      (await callRoute({ source: 'vndb', lookupId: 'v123' })).json()
    ).resolves.toBe('投稿不存在')
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(fetchMocks.vndb).not.toHaveBeenCalled()
  })

  it('applies the external-fetch limit after ownership and before networking', async () => {
    rateLimitMock.mockResolvedValue('外部数据获取过于频繁')

    const response = await callRoute({ source: 'vndb', lookupId: 'v123' })

    await expect(response.json()).resolves.toBe('外部数据获取过于频繁')
    expect(rateLimitMock).toHaveBeenCalledWith('external-fetch', 7)
    expect(
      prismaMocks.patch_submission.findFirst.mock.invocationCallOrder[0]
    ).toBeLessThan(rateLimitMock.mock.invocationCallOrder[0])
    expect(fetchMocks.vndb).not.toHaveBeenCalled()
  })

  it.each(['pending', 'published', 'rejected'])(
    'rejects %s before networking',
    async (status) => {
      prismaMocks.patch_submission.findFirst.mockResolvedValue({ status })

      await callRoute({ source: 'vndb', lookupId: 'v123' })

      expect(rateLimitMock).not.toHaveBeenCalled()
      expect(fetchMocks.vndb).not.toHaveBeenCalled()
    }
  )

  it('stores the normalized lookup id and a verified empty snapshot', async () => {
    fetchMocks.bangumi.mockResolvedValue({
      ...bangumiData,
      developers: [],
      companyReferences: []
    })

    const response = await callRoute({ source: 'bangumi', lookupId: '00123' })

    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(database.row.company_candidates).toMatchObject({
      bangumi: { lookupId: '00123', candidates: [] }
    })
  })

  it('preserves Bangumi source roles while mapping product roles', async () => {
    fetchMocks.bangumi.mockResolvedValue({
      ...bangumiData,
      developers: ['Developer', 'Publisher', 'Committee'],
      companyReferences: [
        { name: 'Developer', sourceRole: '开发商' },
        { name: 'Publisher', sourceRole: '发行' },
        { name: 'Committee', sourceRole: '制作' }
      ]
    })

    await callRoute({ source: 'bangumi', lookupId: '42' })

    expect(database.row.company_candidates).toMatchObject({
      bangumi: {
        candidates: [
          { name: 'Developer', roles: ['developer'], sourceRoles: ['开发商'] },
          { name: 'Publisher', roles: ['publisher'], sourceRoles: ['发行'] },
          { name: 'Committee', roles: ['unknown'], sourceRoles: ['制作'] }
        ]
      }
    })
  })

  it('keeps the Steam developer link as non-identity evidence', async () => {
    await callRoute({ source: 'steam', lookupId: '99' })

    expect(database.row.company_candidates).toMatchObject({
      steam: {
        candidates: [
          {
            name: 'Porting Studio',
            externalId: '',
            externalUrls: ['https://store.steampowered.com'],
            sourceWebsites: ['https://store.steampowered.com']
          }
        ]
      }
    })
  })

  it('rechecks the row after networking and refuses a submission made in flight', async () => {
    fetchMocks.vndb.mockImplementation(async () => {
      database.row.status = 'pending'
      return vndbData
    })

    const response = await callRoute({ source: 'vndb', lookupId: 'V123' })

    await expect(response.json()).resolves.toBe(
      '投稿已在抓取期间提交审核, 本次外部数据未保存'
    )
    expect(prismaMocks._tx.patch_submission.update).not.toHaveBeenCalled()
  })
})

describe('patch submission external snapshot serialization', () => {
  it('merges parallel source saves without overwriting another source slot', async () => {
    await Promise.all([
      savePatchSubmissionCompanyCandidateSnapshot({
        submissionId: 12,
        userId: 7,
        source: 'vndb',
        lookupId: 'v123',
        candidates: [
          {
            source: 'vndb',
            externalId: 'p1',
            name: 'Studio',
            aliases: [],
            roles: ['developer'],
            sourceRoles: ['developer'],
            entityType: 'company',
            externalUrls: [],
            primaryLanguage: 'ja',
            sourceWebsites: []
          }
        ]
      }),
      savePatchSubmissionCompanyCandidateSnapshot({
        submissionId: 12,
        userId: 7,
        source: 'bangumi',
        lookupId: '42',
        candidates: []
      }),
      savePatchSubmissionCompanyCandidateSnapshot({
        submissionId: 12,
        userId: 7,
        source: 'steam',
        lookupId: '99',
        candidates: []
      })
    ])

    expect(database.row.company_candidates).toMatchObject({
      vndb: { lookupId: 'v123' },
      bangumi: { lookupId: '42' },
      steam: { lookupId: '99' },
      dlsite: null
    })
    expect(prismaMocks._tx.$queryRaw).toHaveBeenCalledTimes(3)
  })
})
