import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getTagSchema } from '~/validations/tag'
import { getBlockedTagIds } from '~/app/api/utils/getBlockedTagIds'
import { getTag } from '../service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getTagSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const blockedTagIds = await getBlockedTagIds(req)
  const response = await getTag(input, blockedTagIds)
  return NextResponse.json(response)
}
