import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getPatchByTagSchema } from '~/validations/tag'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { getPatchByTag } from '../service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getPatchByTagSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const nsfwEnable = getNSFWHeader(req)

  const response = await getPatchByTag(input, nsfwEnable)
  return NextResponse.json(response)
}
