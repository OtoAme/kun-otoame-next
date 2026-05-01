import { NextRequest, NextResponse } from 'next/server'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { getRandomUniqueId } from './service'

export const GET = async (req: NextRequest) => {
  const nsfwEnable = getNSFWHeader(req)

  const response = await getRandomUniqueId(nsfwEnable)
  return NextResponse.json(response)
}
