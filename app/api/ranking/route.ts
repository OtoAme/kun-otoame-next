import { NextRequest, NextResponse } from 'next/server'
import { rankingSchema } from '~/validations/ranking'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { getRanking } from './service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, rankingSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const nsfwEnable = getNSFWHeader(req)

  const response = await getRanking(input, nsfwEnable)
  return NextResponse.json(response)
}
