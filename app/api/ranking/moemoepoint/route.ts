import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getMoemoepointRanking } from '~/app/api/moemoepoint/query'
import { moemoepointRankingQuerySchema } from '~/validations/moemoepoint'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, moemoepointRankingQuerySchema)
  if (typeof input === 'string') {
    return NextResponse.json(input, { status: 400 })
  }

  const result = await getMoemoepointRanking(input)
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60'
    }
  })
}
