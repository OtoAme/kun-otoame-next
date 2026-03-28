import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '~/prisma/index'
import { getCompanySchema } from '~/validations/company'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getOrSet } from '~/lib/redis'
import { createHash } from 'crypto'

export const getCompany = async (input: z.infer<typeof getCompanySchema>) => {
  const cacheKey = `company_list:${createHash('md5')
    .update(JSON.stringify(input))
    .digest('hex')}`

  return await getOrSet(
    cacheKey,
    async () => {
      const { page, limit } = input
      const offset = (page - 1) * limit

      const [companies, total] = await Promise.all([
        prisma.patch_company.findMany({
          take: limit,
          skip: offset,
          select: {
            id: true,
            name: true,
            count: true,
            alias: true
          },
          orderBy: { count: 'desc' }
        }),
        prisma.patch_company.count()
      ])

      return { companies, total }
    },
    10
  )
}

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getCompanySchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await getCompany(input)
  return NextResponse.json(response)
}
