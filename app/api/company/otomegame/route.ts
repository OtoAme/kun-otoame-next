import { NextRequest, NextResponse } from 'next/server'
import { getPatchByCompanySchema } from '~/validations/company'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getNSFWHeader } from '~/app/api/utils/getNSFWHeader'
import { getPatchByCompany } from '../service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getPatchByCompanySchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const nsfwEnable = getNSFWHeader(req)

  const response = await getPatchByCompany(input, nsfwEnable)
  return NextResponse.json(response)
}
