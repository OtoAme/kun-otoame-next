import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '~/prisma/index'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { uploadPatchGalleryImage } from '../_upload'

export const POST = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }
  if (payload.role < 3) {
    return NextResponse.json('本页面仅管理员可访问')
  }

  const formData = await req.formData()
  const patchId = Number(formData.get('patchId'))
  const image = formData.get('image') as File | null
  const isNSFW = formData.get('isNSFW') === 'true'
  const watermark = formData.get('watermark') === 'true'
  const displayOrder = Number(formData.get('displayOrder') ?? 0)

  if (!patchId || !image) {
    return NextResponse.json('缺少必要参数')
  }

  const patch = await prisma.patch.findUnique({ where: { id: patchId } })
  if (!patch) {
    return NextResponse.json('未找到对应游戏')
  }

  const galleryRecord = await prisma.patch_game_image.create({
    data: {
      patch_id: patchId,
      url: '',
      is_nsfw: isNSFW,
      display_order: displayOrder
    }
  })

  try {
    const arrayBuffer = await image.arrayBuffer()

    let uploadRes: string | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      uploadRes = await uploadPatchGalleryImage(
        arrayBuffer,
        patchId,
        galleryRecord.id,
        watermark
      )
      if (typeof uploadRes !== 'string') break
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }

    if (typeof uploadRes === 'string') {
      await prisma.patch_game_image
        .delete({ where: { id: galleryRecord.id } })
        .catch(() => {})
      return NextResponse.json(uploadRes)
    }

    const imageUrl = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${patchId}/gallery/${galleryRecord.id}.avif`

    await prisma.patch_game_image.update({
      where: { id: galleryRecord.id },
      data: { url: imageUrl }
    })

    return NextResponse.json({ imageId: galleryRecord.id, url: imageUrl })
  } catch (error) {
    console.error('Gallery upload error:', error)
    await prisma.patch_game_image
      .delete({ where: { id: galleryRecord.id } })
      .catch(() => {})
    return NextResponse.json('图片上传失败')
  }
}
