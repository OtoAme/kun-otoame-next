import { beforeEach, describe, expect, it, vi } from 'vitest'

const responseCacheMock = vi.hoisted(() => vi.fn())
const serviceMocks = vi.hoisted(() => ({
  getPatchByTag: vi.fn(),
  getPatchByCompany: vi.fn()
}))
const visibilityMocks = vi.hoisted(() => ({
  getBlockedTagIds: vi.fn(),
  getNSFWHeader: vi.fn()
}))

vi.mock('~/app/api/utils/anonymousApiResponseCache', () => ({
  getCachedAnonymousJsonResponse: responseCacheMock
}))

vi.mock('~/app/api/tag/service', () => ({
  getPatchByTag: serviceMocks.getPatchByTag
}))

vi.mock('~/app/api/company/service', () => ({
  getPatchByCompany: serviceMocks.getPatchByCompany
}))

vi.mock('~/app/api/utils/getBlockedTagIds', () => ({
  getBlockedTagIds: visibilityMocks.getBlockedTagIds
}))

vi.mock('~/app/api/utils/getNSFWHeader', () => ({
  getNSFWHeader: visibilityMocks.getNSFWHeader
}))

import { GET as getTagOtomegame } from '~/app/api/tag/otomegame/route'
import { GET as getCompanyOtomegame } from '~/app/api/company/otomegame/route'

const validTagUrl =
  'https://example.test/api/tag/otomegame?tagId=15&page=1&limit=24&selectedType=all&selectedLanguage=all&selectedPlatform=all&sortField=resource_update_time&sortOrder=desc&yearString=%5B%22all%22%5D&monthString=%5B%22all%22%5D&minRatingCount=0'

const validCompanyUrl =
  'https://example.test/api/company/otomegame?companyId=4&page=1&limit=24&selectedType=all&selectedLanguage=all&selectedPlatform=all&sortField=resource_update_time&sortOrder=desc&yearString=%5B%22all%22%5D&monthString=%5B%22all%22%5D&minRatingCount=0'

describe('tag/company otomegame API response caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    responseCacheMock.mockImplementation(
      async (_req: Request, _namespace: string, producer: () => Promise<{}>) =>
        Response.json(await producer())
    )
    serviceMocks.getPatchByTag.mockResolvedValue({ galgames: [], total: 0 })
    serviceMocks.getPatchByCompany.mockResolvedValue({ galgames: [], total: 0 })
    visibilityMocks.getBlockedTagIds.mockResolvedValue([])
    visibilityMocks.getNSFWHeader.mockReturnValue({ content_limit: 'sfw' })
  })

  it('wraps valid tag otomegame responses in the anonymous response cache', async () => {
    const req = new Request(validTagUrl)

    await getTagOtomegame(req as never)

    expect(responseCacheMock).toHaveBeenCalledWith(
      req,
      'tag_otomegame',
      expect.any(Function)
    )
  })

  it('wraps valid company otomegame responses in the anonymous response cache', async () => {
    const req = new Request(validCompanyUrl)

    await getCompanyOtomegame(req as never)

    expect(responseCacheMock).toHaveBeenCalledWith(
      req,
      'company_otomegame',
      expect.any(Function)
    )
  })

  it('applies blocked tag visibility to personalized company list responses', async () => {
    const req = new Request(validCompanyUrl)
    visibilityMocks.getBlockedTagIds.mockResolvedValue([2, 1])

    await getCompanyOtomegame(req as never)

    expect(serviceMocks.getPatchByCompany).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 4 }),
      {
        content_limit: 'sfw',
        NOT: {
          tag: {
            some: {
              tag_id: {
                in: [1, 2]
              }
            }
          }
        }
      }
    )
  })

  it('does not cache invalid tag query responses', async () => {
    const response = await getTagOtomegame(
      new Request('https://example.test/api/tag/otomegame?tagId=15') as never
    )

    expect(responseCacheMock).not.toHaveBeenCalled()
    expect(await response.json()).toContain('Invalid')
  })
})
