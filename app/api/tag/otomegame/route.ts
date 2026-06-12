import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getPatchByTagSchema } from '~/validations/tag'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { getBlockedTagIds } from '~/app/api/utils/getBlockedTagIds'
import { buildBlockedTagWhere } from '~/utils/blockedTag'
import { getPatchByTag } from '../service'
import { getCachedAnonymousJsonResponse } from '~/app/api/utils/anonymousApiResponseCache'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getPatchByTagSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  return getCachedAnonymousJsonResponse(req, 'tag_otomegame', async () => {
    const blockedTagIds = await getBlockedTagIds(req)
    const visibilityWhere = {
      ...getNSFWHeader(req),
      ...buildBlockedTagWhere(blockedTagIds)
    }

    return getPatchByTag(input, visibilityWhere)
  })
}
