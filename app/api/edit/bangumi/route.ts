import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { fetchBangumiDetailsData } from './service'

const bangumiSchema = z.object({
  bangumiId: z.string().regex(/^\d+$/, 'Bangumi ID 必须为纯数字')
})

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, bangumiSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  try {
    return NextResponse.json(await fetchBangumiDetailsData(input.bangumiId))
  } catch (error) {
    if (error instanceof Error && error.message === 'BANGUMI_NOT_FOUND') {
      return NextResponse.json('未找到对应的 Bangumi 条目')
    }
    return NextResponse.json('Bangumi API 请求失败')
  }
}
