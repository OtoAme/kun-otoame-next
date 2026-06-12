import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { invalidateTagCaches } from '~/app/api/patch/cache'
import { prisma } from '~/prisma/index'

export const DELETE = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }
  if (payload.role < 3) {
    return NextResponse.json('本页面仅管理员可访问')
  }

  const result = await prisma.patch_tag.deleteMany({
    where: {
      count: 0
    }
  })
  await invalidateTagCaches()

  return NextResponse.json({ count: result.count })
}
