import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getPatchIntroduction, uniqueIdSchema } from './service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, uniqueIdSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await getPatchIntroduction(input)
  return NextResponse.json(response)
}
