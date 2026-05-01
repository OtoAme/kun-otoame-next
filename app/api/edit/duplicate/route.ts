import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { duplicateSchema } from '~/validations/edit'
import { duplicate } from './service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, duplicateSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await duplicate(input)
  return NextResponse.json(response)
}
