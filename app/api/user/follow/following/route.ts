import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { getUserFollowStatusSchema } from '~/validations/user'
import { getUserFollowing } from '../service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getUserFollowStatusSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }
  const payload = await verifyHeaderCookie(req)

  const response = await getUserFollowing(input, payload?.uid)
  return NextResponse.json(response)
}
