import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { fetchVndbDetailsData } from './service'

const detailsSchema = z.object({
  vndbId: z.string().regex(/^v\d+$/i, 'VNDB ID 格式不正确')
})

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, detailsSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const vndbId = input.vndbId.toLowerCase()

  try {
    return NextResponse.json(await fetchVndbDetailsData(vndbId))
  } catch (error) {
    if (error instanceof Error && error.message === 'VNDB_NOT_FOUND') {
      return NextResponse.json('未找到对应的 VNDB 条目')
    }
    return NextResponse.json('VNDB API 请求失败')
  }
}
