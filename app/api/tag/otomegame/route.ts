import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getPatchByTagSchema } from '~/validations/tag'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { getBlockedTagIds } from '~/app/api/utils/getBlockedTagIds'
import { buildBlockedTagWhere } from '~/utils/blockedTag'
import { getPatchByTag } from '../service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getPatchByTagSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const blockedTagIds = await getBlockedTagIds(req)
  const visibilityWhere = {
    ...getNSFWHeader(req),
    ...buildBlockedTagWhere(blockedTagIds)
  }

  const response = await getPatchByTag(input, visibilityWhere)
  return NextResponse.json(response)
}
