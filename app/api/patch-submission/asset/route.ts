import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { verifyKunCsrf } from '~/middleware/_csrf'
import {
  patchSubmissionBannerUploadSchema,
  patchSubmissionGalleryDeleteSchema,
  patchSubmissionGalleryUploadSchema
} from '~/validations/patchSubmission'
import { GALLERY_IMAGE_MAX_SIZE_MB } from '~/constants/galgame'
import { PatchSubmissionError } from '../quota'
import {
  deletePatchSubmissionGalleryImage,
  uploadPatchSubmissionBanner,
  uploadPatchSubmissionGalleryImage
} from '../assets'
import { checkPatchSubmissionRateLimit } from '../rateLimit'

const privateJson = (body: unknown) =>
  NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })

/**
 * Order matters and is fixed by Stage 2.1: authenticate, authorize, rate limit,
 * and only then read the body. imageFileSchema can only inspect a file that has
 * already been parsed, so it cannot protect the parsing step itself.
 *
 * formData() throws on a body over roughly 10 MiB, and without this guard Next
 * answers with a 500 HTML page that reaches the client as an opaque status.
 */
const readFormData = async (req: NextRequest) => {
  try {
    return await req.formData()
  } catch {
    return `上传请求不完整, 单张图片请控制在 ${GALLERY_IMAGE_MAX_SIZE_MB} MB 以内后重试`
  }
}

export const POST = async (req: NextRequest) => {
  // Excluded from the middleware matcher so the handler can reject before the
  // whole body has been transferred, which means CSRF is ours to verify.
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return NextResponse.json(csrfError, {
      status: 403,
      headers: { 'Cache-Control': 'private, no-store' }
    })
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const limited = await checkPatchSubmissionRateLimit(
    'asset-upload',
    payload.uid
  )
  if (limited) {
    return privateJson(limited)
  }

  const formData = await readFormData(req)
  if (typeof formData === 'string') {
    return privateJson(formData)
  }

  const kind = formData.get('kind')

  if (kind === 'banner') {
    const parsed = patchSubmissionBannerUploadSchema.safeParse({
      submissionId: formData.get('submissionId'),
      banner: formData.get('banner'),
      bannerOriginal: formData.get('bannerOriginal') ?? undefined
    })
    if (!parsed.success) {
      return privateJson(parsed.error.errors[0]?.message ?? '参数不正确')
    }

    try {
      const result = await uploadPatchSubmissionBanner({
        submissionId: parsed.data.submissionId,
        userId: payload.uid,
        banner: await parsed.data.banner.arrayBuffer(),
        bannerOriginal: await parsed.data.bannerOriginal?.arrayBuffer()
      })
      return privateJson(result)
    } catch (error) {
      if (error instanceof PatchSubmissionError) {
        return privateJson(error.message)
      }
      throw error
    }
  }

  const parsed = patchSubmissionGalleryUploadSchema.safeParse({
    submissionId: formData.get('submissionId'),
    clientAssetId: formData.get('clientAssetId'),
    image: formData.get('image'),
    isNSFW: formData.get('isNSFW') ?? 'false',
    displayOrder: formData.get('displayOrder') ?? 0
  })
  if (!parsed.success) {
    return privateJson(parsed.error.errors[0]?.message ?? '参数不正确')
  }

  try {
    const result = await uploadPatchSubmissionGalleryImage({
      submissionId: parsed.data.submissionId,
      userId: payload.uid,
      clientAssetId: parsed.data.clientAssetId,
      image: await parsed.data.image.arrayBuffer(),
      isNSFW: parsed.data.isNSFW === 'true',
      displayOrder: parsed.data.displayOrder
    })
    return privateJson(result)
  } catch (error) {
    if (error instanceof PatchSubmissionError) {
      return privateJson(error.message)
    }
    throw error
  }
}

export const DELETE = async (req: NextRequest) => {
  const csrfError = verifyKunCsrf(req)
  if (csrfError) {
    return NextResponse.json(csrfError, {
      status: 403,
      headers: { 'Cache-Control': 'private, no-store' }
    })
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return privateJson('请求体不正确')
  }

  const parsed = patchSubmissionGalleryDeleteSchema.safeParse(body)
  if (!parsed.success) {
    return privateJson(parsed.error.errors[0]?.message ?? '参数不正确')
  }

  try {
    return privateJson(
      await deletePatchSubmissionGalleryImage(
        parsed.data.submissionId,
        parsed.data.galleryId,
        payload.uid
      )
    )
  } catch (error) {
    if (error instanceof PatchSubmissionError) {
      return privateJson(error.message)
    }
    throw error
  }
}
