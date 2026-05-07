import { deleteFileFromS3, uploadFileToS3 } from '~/lib/s3'
import { getKv } from '~/lib/redis'
import {
  invalidatePatchContentCache,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import { prisma as globalPrisma } from '~/prisma/index'

export const uploadPatchResource = async (patchId: number, hash: string) => {
  const filePath = await getKv(hash)
  if (!filePath) {
    return '本地临时文件存储未找到, 请重新上传文件'
  }
  const fileName = filePath.split('/').pop()
  const s3Key = `patch/${patchId}/resource/${hash}/${fileName}`
  await uploadFileToS3(s3Key, filePath)
  const downloadLink = `${process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL!}/${s3Key}`
  return { downloadLink }
}

export const deletePatchResourceLink = async (
  content: string,
  patchId: number,
  hash: string
) => {
  const fileName = content.split('/').pop()
  if (!fileName) {
    return
  }
  const s3Key = `patch/${patchId}/resource/${hash}/${fileName}`
  await deleteFileFromS3(s3Key)
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
