import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { searchTagSchema } from '~/validations/search'
import { searchTag } from '../service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, searchTagSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await searchTag(input)
  return NextResponse.json(response)
}
