import { beforeEach, describe, expect, it, vi } from 'vitest'

const responseCacheMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/utils/anonymousApiResponseCache', () => ({
  getCachedAnonymousJsonResponse: responseCacheMock
}))

vi.mock('~/app/api/tag/service', () => ({
  getPatchByTag: vi.fn()
}))

vi.mock('~/app/api/company/service', () => ({
  getPatchByCompany: vi.fn()
}))

vi.mock('~/app/api/utils/getBlockedTagIds', () => ({
  getBlockedTagIds: vi.fn()
}))

vi.mock('~/app/api/utils/getNSFWHeader', () => ({
  getNSFWHeader: vi.fn()
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
    responseCacheMock.mockResolvedValue(new Response('{}'))
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

  it('does not cache invalid tag query responses', async () => {
    const response = await getTagOtomegame(
      new Request('https://example.test/api/tag/otomegame?tagId=15') as never
    )

    expect(responseCacheMock).not.toHaveBeenCalled()
    expect(await response.json()).toContain('Invalid')
  })
})
