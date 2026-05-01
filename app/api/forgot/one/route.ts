import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { stepOneSchema } from '~/validations/forgot'
import { stepOne } from '../service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, stepOneSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await stepOne(input, req.headers)
  if (typeof response === 'string') {
    return NextResponse.json(input)
  }

  return NextResponse.json({})
}
