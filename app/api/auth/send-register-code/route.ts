import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { sendRegisterEmailVerificationCodeSchema } from '~/validations/auth'
import { sendRegisterCode } from './service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(
    req,
    sendRegisterEmailVerificationCodeSchema
  )
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  if (!req.headers || !req.headers.get('x-forwarded-for')) {
    return NextResponse.json('读取请求头失败')
  }

  const response = await sendRegisterCode(input, req.headers)
  return NextResponse.json(response)
}
