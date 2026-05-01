import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { searchUserSchema } from '~/validations/user'
import { searchUser } from './service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, searchUserSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await searchUser(input)
  return NextResponse.json(response)
}
