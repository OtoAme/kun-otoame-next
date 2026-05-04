import { NextRequest, NextResponse } from 'next/server'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { getHomeData } from './service'

export const GET = async (req: NextRequest) => {
  const visibilityWhere = await getPatchVisibilityWhere(req)

  const response = await getHomeData(visibilityWhere)
  return NextResponse.json(response)
}
