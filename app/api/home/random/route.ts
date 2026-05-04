import { NextRequest, NextResponse } from 'next/server'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { getRandomUniqueId } from './service'

export const GET = async (req: NextRequest) => {
  const visibilityWhere = await getPatchVisibilityWhere(req)

  const response = await getRandomUniqueId(visibilityWhere)
  return NextResponse.json(response)
}
