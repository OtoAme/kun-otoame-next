import {
  cleanupLocalUpload,
  deleteFileFromS3,
  uploadFileToS3
} from '~/lib/s3'
import {
  consumeUpload,
  finalizeUpload,
  releaseUploadConsumeLock
} from '~/lib/redis'
import {
  invalidatePatchContentCache,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import { prisma as globalPrisma } from '~/prisma/index'

export type UploadedPatchResource = {
  uploadId: string
  consumeToken: string
  s3Key: string
  downloadLink: string
  localDir: string
  hash: string
  size: string
}

const getS3PublicUrlPrefix = () =>
  `${process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL!}/`

export const extractS3Key = (content: string) => {
  const prefix = getS3PublicUrlPrefix()
  if (!content.startsWith(prefix)) {
    return null
  }

  return content.slice(prefix.length)
}

export const uploadPatchResource = async (
  patchId: number,
  uploadId: string,
  userId: number
): Promise<UploadedPatchResource | string> => {
  const consumed = await consumeUpload(uploadId, userId)
  if (!consumed.ok) {
    if (consumed.code === 'ALREADY_CONSUMING') {
      return '资源正在提交中，请稍后重试'
    }
    if (consumed.code === 'OWNER_MISMATCH') {
      return '上传资源不属于当前用户'
    }
    return '本地临时文件存储未找到, 请重新上传文件'
  }

  const metadata = consumed.data
  const s3Key = `patch/${patchId}/resource/${metadata.hash}/${metadata.filename}`
  try {
    await uploadFileToS3(s3Key, metadata.path)
  } catch (error) {
    await releaseUploadConsumeLock(uploadId, consumed.token)
    throw error
  }
  const downloadLink = `${getS3PublicUrlPrefix()}${s3Key}`

  return {
    uploadId,
    consumeToken: consumed.token,
    s3Key,
    downloadLink,
    localDir: metadata.localDir,
    hash: metadata.hash,
    size: metadata.size
  }
}

export const deletePatchResourceLink = async (
  content: string,
  excludeLinkIds: number[] = []
) => {
  const referencedCount = await globalPrisma.patch_resource_link.count({
    where: {
      content,
      ...(excludeLinkIds.length ? { id: { notIn: excludeLinkIds } } : {})
    }
  })
  if (referencedCount > 0) {
    return
  }

  const s3Key = extractS3Key(content)
  if (!s3Key) {
    console.error('[Upload] Refused to delete S3 object with invalid URL', {
      content
    })
    return
  }

  await deleteFileFromS3(s3Key)
}

export const compensateUploadedResources = async (
  resources: UploadedPatchResource[]
) => {
  await Promise.allSettled(
    resources.map((resource) => deleteFileFromS3(resource.s3Key))
  )
}

export const releaseUploadedResourceLocks = async (
  resources: UploadedPatchResource[]
) => {
  await Promise.allSettled(
    resources.map((resource) =>
      releaseUploadConsumeLock(resource.uploadId, resource.consumeToken)
    )
  )
}

export const finalizeUploadedResources = async (
  resources: UploadedPatchResource[],
  context: { userId: number; patchId: number; resourceId?: number }
) => {
  const results = await Promise.allSettled(
    resources.map((resource) =>
      finalizeUpload(resource.uploadId, resource.consumeToken)
    )
  )

  for (const [index, result] of results.entries()) {
    const resource = resources[index]
    if (result.status === 'rejected') {
      console.error(
        '[CRITICAL] Upload finalize failed - manual cleanup may be needed',
        { ...context, ...resource, error: result.reason }
      )
      continue
    }

    if (!result.value.ok) {
      console.error(
        '[CRITICAL] Upload finalize failed - manual cleanup may be needed',
        { ...context, ...resource, error: result.value.code }
      )
    }
  }
}

export const cleanupUploadedResourceDirs = async (
  resources: UploadedPatchResource[],
  context: { userId: number; patchId: number; resourceId?: number }
) => {
  const results = await Promise.allSettled(
    resources.map((resource) => cleanupLocalUpload(resource.localDir))
  )

  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error('[Upload] Local cleanup failed, cron will handle', {
        ...context,
        ...resources[index],
        error: result.reason
      })
    }
  }
}

export const sanitizeResourceLinksForAuditLog = <
  R extends {
    content?: string
    code?: string
    password?: string
    hash?: string
  }
>(
  links: R[] | undefined | null
): Omit<R, 'content' | 'code' | 'password' | 'hash'>[] => {
  if (!links) {
    return []
  }
  return links.map(({ content, code, password, hash, ...rest }) => rest)
}

export const sanitizeResourceForAuditLog = <R extends { links?: any[] }>(
  resource: R
) => ({
  ...resource,
  links: sanitizeResourceLinksForAuditLog(resource.links)
})

export const updatePatchAttributes = async (patchId: number, tx?: any) => {
  const prisma = tx || globalPrisma
  const resources = await prisma.patch_resource.findMany({
    where: { patch_id: patchId, status: 0 },
    select: {
      type: true,
      language: true,
      platform: true
    }
  })

  const types = new Set<string>()
  const languages = new Set<string>()
  const platforms = new Set<string>()

  resources.forEach((resource: any) => {
    resource.type.forEach((t: string) => types.add(t))
    resource.language.forEach((l: string) => languages.add(l))
    resource.platform.forEach((p: string) => platforms.add(p))
  })

  const patch = await prisma.patch.update({
    where: { id: patchId },
    data: {
      resource_update_time: new Date(),
      type: Array.from(types),
      language: Array.from(languages),
      platform: Array.from(platforms)
    },
    select: {
      unique_id: true
    }
  })

  return patch.unique_id
}

export const deletePatchResourceCache = async (uniqueId: string) => {
  await Promise.all([
    invalidatePatchContentCache(uniqueId),
    invalidatePatchListCaches()
  ])
}
