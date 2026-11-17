import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '~/prisma/index'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { preferenceRoute } from '~/lib/accountPreferences/http'

const getBlockedTags = async (uid: number) => {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { blocked_tag_ids: true }
  })
  if (!user) {
    return '未找到用户'
  }
  if (!user.blocked_tag_ids.length) {
    return []
  }

  const tags = await prisma.patch_tag.findMany({
    where: { id: { in: user.blocked_tag_ids } },
    select: {
      id: true,
      name: true,
      count: true,
      alias: true
    }
  })

  const tagMap = new Map(tags.map((tag) => [tag.id, tag]))

  return user.blocked_tag_ids.map((id) => tagMap.get(id)).filter((tag) => !!tag)
}

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }

  const response = await getBlockedTags(payload.uid)
  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'private, no-store' }
  })
}

export const POST = (req: NextRequest) =>
  preferenceRoute(req, true, 'blocked-tag:')
export const DELETE = (req: NextRequest) =>
  preferenceRoute(req, true, 'blocked-tag:')
