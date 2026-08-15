import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/middleware/_csrf'
import {
  STICKER_MAX_IMPORT_BYTES,
  STICKER_MAX_IMPORT_ITEMS,
  STICKER_STATIC_MAX_BYTES,
  STICKER_MAX_ZIP_BYTES,
  STICKER_WEBM_MAX_BYTES
} from '~/lib/stickerAssets'
import { importStickerAssets } from '../service'
import { adminStickerPackCreateSchema } from '~/validations/sticker'

const jsonPrivate = (body: unknown, status?: number) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  })

const getStringField = (formData: FormData, name: string) => {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

const formatFileSizeLimit = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${bytes / 1024 / 1024} MB`
    : `${bytes / 1024} KB`

export const POST = async (req: NextRequest) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return jsonPrivate(csrfError, 403)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return jsonPrivate('用户未登录')
  }
  if (payload.role < 3) {
    return jsonPrivate('本页面仅管理员可访问')
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return jsonPrivate('Sticker 上传请求不完整，请重新选择文件后重试', 400)
  }
  const rawPackId = getStringField(formData, 'packId')
  const packId = rawPackId ? Number(rawPackId) : null
  if (packId !== null && (!Number.isInteger(packId) || packId < 1)) {
    return jsonPrivate('Pack ID 无效')
  }

  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File)
  if (!files.length) {
    return jsonPrivate('请至少选择一个 WebP、WebM 或 ZIP 文件')
  }
  if (files.length > STICKER_MAX_IMPORT_ITEMS) {
    return jsonPrivate(`单次最多选择 ${STICKER_MAX_IMPORT_ITEMS} 个文件`)
  }

  let totalBytes = 0
  const sources = []
  for (const file of files) {
    const extension = path.extname(file.name).toLowerCase()
    const maxBytes =
      extension === '.zip'
        ? STICKER_MAX_ZIP_BYTES
        : extension === '.webm'
          ? STICKER_WEBM_MAX_BYTES
          : STICKER_STATIC_MAX_BYTES
    if (file.size > maxBytes) {
      return jsonPrivate(
        `${file.name}: 文件不能超过 ${formatFileSizeLimit(maxBytes)}`
      )
    }
    totalBytes += file.size
    if (totalBytes > STICKER_MAX_IMPORT_BYTES) {
      return jsonPrivate(
        `单次导入文件总大小不能超过 ${STICKER_MAX_IMPORT_BYTES / 1024 / 1024} MB`
      )
    }
    sources.push({
      name: file.name,
      buffer: Buffer.from(await file.arrayBuffer())
    })
  }

  const slug = getStringField(formData, 'slug')
  const name = getStringField(formData, 'name')
  const description = getStringField(formData, 'description')
  if (!packId) {
    const parsed = adminStickerPackCreateSchema.safeParse({
      slug,
      name,
      description
    })
    if (!parsed.success) {
      return jsonPrivate(
        parsed.error.issues[0]?.message ?? '新建 Pack 参数无效'
      )
    }
  }

  const response = await importStickerAssets({
    packId,
    slug: packId ? undefined : slug,
    name: packId ? undefined : name,
    description: packId ? undefined : description,
    files: sources,
    uid: payload.uid
  })
  return jsonPrivate(response, typeof response === 'string' ? 400 : undefined)
}
