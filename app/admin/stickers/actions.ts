'use server'

import { getAdminStickerPacks } from '~/app/api/admin/stickers/service'
import { verifyHeaderCookie } from '~/utils/actions/verifyHeaderCookie'

export const kunGetStickerPacks = async () => {
  const payload = await verifyHeaderCookie()
  if (!payload) {
    return '用户登录已失效'
  }
  if (payload.role < 3) {
    return '本页面仅管理员可访问'
  }

  return getAdminStickerPacks()
}
