import { NextRequest, NextResponse } from 'next/server'
import { kunParsePutBody } from '~/app/api/utils/parseQuery'
import { updatePatchResourceStatsSchema } from '~/validations/patch'
import { downloadStats } from './service'

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, updatePatchResourceStatsSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await downloadStats(input)
  return NextResponse.json(response)
}
