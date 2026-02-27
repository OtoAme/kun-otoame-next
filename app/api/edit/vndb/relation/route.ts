import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'

const relationSchema = z.object({
  relationId: z.string().regex(/^r\d+$/i, 'Relation ID 格式不正确')
})

interface VNDBReleaseResult {
  id: string
  title?: string
  released?: string
  vns?: { id: string; title?: string }[]
}

interface VNDBReleaseResponse {
  results: VNDBReleaseResult[]
}

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, relationSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const relationId = input.relationId.toLowerCase()

  try {
    const response = await fetch('https://api.vndb.org/kana/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: ['id', '=', relationId],
        fields: 'title, released, vns.id, vns.title'
      })
    })

    if (!response.ok) {
      return NextResponse.json('VNDB Release API 请求失败')
    }

    const data: VNDBReleaseResponse = await response.json()
    if (!data.results?.length) {
      return NextResponse.json('未找到对应的 VNDB Release')
    }

    const release = data.results[0]
    const vndbId = release.vns?.[0]?.id?.toLowerCase()
    if (!vndbId) {
      return NextResponse.json('未能在 Release 数据中找到关联的 VN ID')
    }

    const titles: string[] = []
    if (release.title) {
      titles.push(release.title)
    }

    return NextResponse.json({
      vndbId,
      titles,
      released: release.released ?? ''
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json('VNDB Release API 请求失败')
  }
}
