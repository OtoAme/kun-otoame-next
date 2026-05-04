import { NextRequest, NextResponse } from 'next/server'
import { searchCompanySchema } from '~/validations/company'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { searchCompany } from '../service'

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, searchCompanySchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await searchCompany(input)
  return NextResponse.json(response)
}
