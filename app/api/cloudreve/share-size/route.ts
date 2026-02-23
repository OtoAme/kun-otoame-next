import { NextRequest, NextResponse } from 'next/server'
import { CLOUDREVE_PAN_DOMAIN } from '~/components/patch/resource/publish/fetchAlistSize'

export const GET = async (req: NextRequest) => {
  const key = req.nextUrl.searchParams.get('key')
  if (!key || !/^[a-zA-Z0-9]+$/.test(key)) {
    return NextResponse.json({ error: '无效的分享 key' }, { status: 400 })
  }

  try {
    const infoRes = await fetch(
      `https://${CLOUDREVE_PAN_DOMAIN}/api/v3/share/info/${key}`
    )
    if (!infoRes.ok) {
      return NextResponse.json(
        { error: '获取分享信息失败' },
        { status: infoRes.status }
      )
    }
    const infoData = await infoRes.json()

    if (infoData.code !== 0) {
      return NextResponse.json(
        { error: infoData.msg || '获取分享信息失败' },
        { status: 400 }
      )
    }

    if (infoData.data.source.size > 0) {
      return NextResponse.json({ size: infoData.data.source.size })
    }

    const listRes = await fetch(
      `https://${CLOUDREVE_PAN_DOMAIN}/api/v3/share/list/${infoData.data.key}`
    )
    if (!listRes.ok) {
      return NextResponse.json(
        { error: '获取文件列表失败' },
        { status: listRes.status }
      )
    }
    const listData = await listRes.json()

    if (
      listData.code === 0 &&
      listData.data.objects &&
      listData.data.objects.length > 0
    ) {
      const totalSize = listData.data.objects.reduce(
        (sum: number, obj: { size: number }) => sum + obj.size,
        0
      )
      return NextResponse.json({ size: totalSize })
    }

    return NextResponse.json({ error: '无法获取文件大小' }, { status: 404 })
  } catch {
    return NextResponse.json({ error: '请求失败' }, { status: 500 })
  }
}
