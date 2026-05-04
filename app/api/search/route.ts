import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { searchSchema } from '~/validations/search'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { searchGalgame } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, searchSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const visibilityWhere = await getPatchVisibilityWhere(req)

  const response = await searchGalgame(input, visibilityWhere)
  return NextResponse.json(response)
}
