import { NextRequest, NextResponse } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { stepTwoSchema } from '~/validations/forgot'
import { stepTwo } from '../service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, stepTwoSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await stepTwo(input)
  if (typeof response === 'string') {
    return NextResponse.json(response)
  }

  return NextResponse.json({})
}
