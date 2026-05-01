import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { searchSchema } from '~/validations/search'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { searchGalgame } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, searchSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const nsfwEnable = getNSFWHeader(req)

  const response = await searchGalgame(input, nsfwEnable)
  return NextResponse.json(response)
}
