import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { uploadPatchBanner } from './_upload'
import { patchCreateSchema } from '~/validations/edit'
import { kunMoyuMoe } from '~/config/moyu-moe'
import { postToIndexNow } from './_postToIndexNow'
import { processSubmittedExternalData } from './processExternalData'
import {
  invalidateCompanyCaches,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import { CREATE_PATCH_PUBLISH_TIMEOUT_MS } from '~/constants/galgame'
import { applySteamOfficialUrlFallback } from '~/utils/externalIds'
import {
  findFirstUniqueExternalIdDuplicate,
  formatUniqueExternalIdDuplicateMessage,
  resolveUniqueExternalIdConstraintMessage
} from './uniqueExternalIds'
import { earnMoemoepoint } from '~/app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'
import { runEditPostCommitTask, toEditPostCommitWarning } from './postCommit'
import type { CreatePatchResult, EditPostCommitWarning } from '~/types/api/edit'

export const createGalgame = async (
  input: Omit<
    z.infer<typeof patchCreateSchema>,
    'alias' | 'tag' | 'banner' | 'bannerOriginal'
  > & {
    alias: string[]
    tag: string[]
    banner: ArrayBuffer
    bannerOriginal?: ArrayBuffer
  },
  uid: number
) => {
  const {
    name,
    vndbId,
    vndbRelationId,
    bangumiId,
    steamId,
    dlsiteCode,
    dlsiteCircleName,
    dlsiteCircleLink,
    vndbTags,
    vndbDevelopers,
    bangumiTags,
    bangumiDevelopers,
    steamTags,
    steamDevelopers,
    steamAliases,
    alias,
    banner,
    bannerOriginal,
    tag,
    introduction,
    officialUrl,
    released,
    contentLimit,
    isDuplicate
  } = input

  if (vndbId && isDuplicate !== 'true') {
    const existPatch = await prisma.patch.findFirst({
      where: { vndb_id: vndbId }
    })
    if (existPatch) {
      return '该 VNDB ID 已有游戏存在, 如需发布不同版本请先确认重复'
    }
  }

  const galgameUniqueId = crypto.randomBytes(4).toString('hex')

  const normalizedDlsiteCode = dlsiteCode?.trim()
    ? dlsiteCode.trim().toUpperCase()
    : ''
  const normalizedOfficialUrl = applySteamOfficialUrlFallback(
    officialUrl,
    steamId
  )

  const uniqueExternalIdDuplicate = await findFirstUniqueExternalIdDuplicate({
    bangumiId,
    vndbRelationId,
    dlsiteCode: normalizedDlsiteCode
  })
  if (uniqueExternalIdDuplicate) {
    return formatUniqueExternalIdDuplicateMessage(
      uniqueExternalIdDuplicate.field,
      uniqueExternalIdDuplicate.patch.unique_id
    )
  }

  let res:
    | string
    | {
        patchId: number
        balance: Awaited<ReturnType<typeof earnMoemoepoint>>['balance']
      }
  try {
    res = await prisma.$transaction(
      async (prisma) => {
        const patch = await prisma.patch.create({
          data: {
            name,
            unique_id: galgameUniqueId,
            vndb_id: vndbId ? vndbId : null,
            vndb_relation_id: vndbRelationId ? vndbRelationId : null,
            bangumi_id: bangumiId ? Number(bangumiId) : null,
            steam_id: steamId ? Number(steamId) : null,
            dlsite_code: normalizedDlsiteCode ? normalizedDlsiteCode : null,
            introduction,
            official_url: normalizedOfficialUrl,
            user_id: uid,
            banner: '',
            released,
            content_limit: contentLimit
          }
        })

        const newId = patch.id

        const uploadResult = await uploadPatchBanner(
          banner,
          newId,
          bannerOriginal
        )
        if (typeof uploadResult === 'string') {
          return uploadResult
        }
        const imageLink = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${newId}/banner/banner.avif`

        await prisma.patch.update({
          where: { id: newId },
          data: { banner: imageLink }
        })

        // Ensure rating_stat row exists for this patch
        await prisma.patch_rating_stat.create({
          data: { patch_id: newId }
        })

        if (alias.length) {
          const aliasData = alias.map((name) => ({
            name,
            patch_id: newId
          }))
          await prisma.patch_alias.createMany({
            data: aliasData,
            skipDuplicates: true
          })
        }

        await prisma.user.update({
          where: { id: uid },
          data: { daily_image_count: { increment: 1 } }
        })
        const pointChange = await earnMoemoepoint(prisma, {
          userId: uid,
          amount: 3,
          reasonCode: MOEMOEPOINT_REASON.patchCreated.code,
          reason: `${MOEMOEPOINT_REASON.patchCreated.text}：${name.slice(0, 100)}`,
          referenceType: 'patch',
          referenceId: newId,
          link: `/${galgameUniqueId}`,
          idempotencyKey: `patch:${newId}:create-reward`
        })

        return { patchId: newId, balance: pointChange.balance }
      },
      { timeout: CREATE_PATCH_PUBLISH_TIMEOUT_MS }
    )
  } catch (error) {
    const uniqueExternalIdMessage =
      await resolveUniqueExternalIdConstraintMessage(error, {
        bangumiId,
        vndbRelationId,
        dlsiteCode: normalizedDlsiteCode
      })
    if (uniqueExternalIdMessage) {
      return uniqueExternalIdMessage
    }
    throw error
  }

  if (typeof res === 'string') {
    return res
  }

  const warnings: EditPostCommitWarning[] = []
  let externalDataFailed = false
  let companyRelationsChanged = false
  try {
    const externalDataResult = await processSubmittedExternalData(
      res.patchId,
      {
        vndbId,
        vndbTags,
        vndbDevelopers,
        bangumiTags,
        bangumiDevelopers,
        steamTags,
        steamDevelopers,
        steamAliases,
        dlsiteCircleName: dlsiteCircleName ?? '',
        dlsiteCircleLink: dlsiteCircleLink ?? ''
      },
      tag,
      uid
    )
    companyRelationsChanged = externalDataResult.companyRelationsChanged
  } catch (error) {
    externalDataFailed = true
    const warning = toEditPostCommitWarning(error)
    warnings.push(warning)
    if (warning.kind === 'external-data-error') {
      console.error('Failed to process external data after creating a patch', {
        patchId: res.patchId,
        uniqueId: galgameUniqueId,
        error
      })
    }
  }

  await Promise.all([
    runEditPostCommitTask(invalidatePatchListCaches, {
      action: 'invalidate patch list caches',
      patchId: res.patchId,
      uniqueId: galgameUniqueId
    }),
    ...(companyRelationsChanged || externalDataFailed
      ? [
          runEditPostCommitTask(invalidateCompanyCaches, {
            action: 'invalidate company caches',
            patchId: res.patchId,
            uniqueId: galgameUniqueId
          })
        ]
      : [])
  ])

  if (contentLimit === 'sfw') {
    const newPatchUrl = `${kunMoyuMoe.domain.main}/${galgameUniqueId}`
    await runEditPostCommitTask(() => postToIndexNow(newPatchUrl), {
      action: 'notify IndexNow',
      patchId: res.patchId,
      uniqueId: galgameUniqueId
    })
  }

  const result: CreatePatchResult = {
    uniqueId: galgameUniqueId,
    patchId: res.patchId,
    moemoepointBalance: res.balance,
    warnings
  }
  return result
}
