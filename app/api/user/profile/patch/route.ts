import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getUserInfoSchema } from '~/validations/user'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { getUserPatch } from './service'

export async function GET(req: NextRequest) {
  const input = kunParseGetQuery(req, getUserInfoSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  // Published entries are public content, so this mirrors the game lists: no
  // login gate, NSFW filtered by the viewer's own cookie.
  const visibilityWhere = await getPatchVisibilityWhere(req)

  const response = await getUserPatch(input, visibilityWhere)
  return NextResponse.json(response)
}
