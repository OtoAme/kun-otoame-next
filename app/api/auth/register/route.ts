import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { getRemoteIp } from '~/app/api/utils/getRemoteIp'
import { registerSchema } from '~/validations/auth'
import { register } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, registerSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  if (
    !req.headers ||
    (!req.headers.get('x-forwarded-for') &&
      !req.headers.get('x-real-ip') &&
      !req.headers.get('CF-Connecting-IP'))
  ) {
    return NextResponse.json('读取请求头失败')
  }

  const ip = getRemoteIp(req.headers)

  const response = await register(input, ip)
  return NextResponse.json(response)
}
