import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { commentIdSchema, getCommentMarkdown } from './service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, commentIdSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await getCommentMarkdown(input)
  return NextResponse.json(response)
}
