import { NextRequest, NextResponse } from 'next/server'
import { getPatchByCompanySchema } from '~/validations/company'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import {
  ALL_SUPPORTED_LANGUAGE,
  ALL_SUPPORTED_PLATFORM,
  ALL_SUPPORTED_TYPE
} from '~/constants/resource'
import { getPatchByCompany } from '../service'
import { getCachedAnonymousJsonResponse } from '~/app/api/utils/anonymousApiResponseCache'
import { getBlockedTagIds } from '~/app/api/utils/getBlockedTagIds'
import { buildBlockedTagWhere } from '~/utils/blockedTag'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getPatchByCompanySchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  if (
    !ALL_SUPPORTED_TYPE.includes(input.selectedType) ||
    !ALL_SUPPORTED_LANGUAGE.includes(input.selectedLanguage) ||
    !ALL_SUPPORTED_PLATFORM.includes(input.selectedPlatform)
  ) {
    return NextResponse.json('请选择我们支持的 OtomeGame 排序类型')
  }

  return getCachedAnonymousJsonResponse(req, 'company_otomegame', async () => {
    const blockedTagIds = await getBlockedTagIds(req)
    const visibilityWhere = {
      ...getNSFWHeader(req),
      ...buildBlockedTagWhere(blockedTagIds)
    }

    return getPatchByCompany(input, visibilityWhere)
  })
}
