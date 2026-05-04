import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { loginSchema } from '~/validations/auth'
import { login } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, loginSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await login(input)
  return NextResponse.json(response)
}
