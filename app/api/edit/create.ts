import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import {
  cleanupUploadedPatchBanner,
  uploadPatchBanner,
  type PatchBannerUploadResult
} from './_upload'
import { patchCreateSchema } from '~/validations/edit'
import { kunMoyuMoe } from '~/config/moyu-moe'
import { postToIndexNow } from './_postToIndexNow'
import {
  prepareSubmittedExternalDataForCreate,
  processSubmittedExternalDataForCreate,
  type PreparedSubmittedExternalData,
  type ProcessSubmittedExternalDataResult,
  type SubmittedExternalData
} from './processExternalData'
import {
  invalidateCompanyCaches,
  invalidatePatchListCaches,
  invalidateTagCaches
} from '~/app/api/patch/cache'
import {
  PATCH_STATUS_PUBLISHING,
  PATCH_STATUS_VISIBLE
} from '~/constants/patch'

const loggedCreateStepErrors = new WeakSet<object>()

const isObjectLike = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'

const logCreateStepError = (
  step: string,
  error: unknown,
  context: Record<string, unknown>
) => {
  console.error(`[EditCreate] create failed at ${step}`, {
    ...context,
    error
  })

  if (isObjectLike(error)) {
    loggedCreateStepErrors.add(error)
  }
}

const runCreateStep = async <T>(
  step: string,
  context: Record<string, unknown>,
  task: () => Promise<T>
) => {
  try {
    return await task()
  } catch (error) {
    if (!isObjectLike(error) || !loggedCreateStepErrors.has(error)) {
      logCreateStepError(step, error, context)
    }
    throw error
  }
}

const runBestEffortCreateStep = async (
  step: string,
  context: Record<string, unknown>,
  task: () => Promise<unknown>
) => {
  try {
    await task()
  } catch (error) {
    if (!isObjectLike(error) || !loggedCreateStepErrors.has(error)) {
      logCreateStepError(step, error, context)
    }
  }
}

const runCleanupCreateStep = async (
  step: string,
  context: Record<string, unknown>,
  task: () => Promise<unknown>
) => {
  try {
    await task()
  } catch (error) {
    logCreateStepError(step, error, context)
  }
}

const cleanupFailedCreateArtifacts = async (
  patchId: number | null,
  uploadedKeys: string[],
  context: Record<string, unknown>
) => {
  await Promise.all([
    uploadedKeys.length
      ? runCleanupCreateStep('cleanupUploadedPatchBanner', context, () =>
          cleanupUploadedPatchBanner(uploadedKeys)
        )
      : Promise.resolve(),
    patchId
      ? runCleanupCreateStep('cleanupPublishingPatch', context, () =>
          prisma.patch.delete({ where: { id: patchId } })
        )
      : Promise.resolve()
  ])
}

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
    const existPatch = await runCreateStep(
      'checkVndbDuplicate',
      { uid, name, vndbId },
      () =>
        prisma.patch.findFirst({
          where: { vndb_id: vndbId }
        })
    )
    if (existPatch) {
      return '该 VNDB ID 已有游戏存在, 如需发布不同版本请先确认重复'
    }
  }

  // vndbRelationId strict uniqueness check (cannot be bypassed)
  if (vndbRelationId) {
    const normalizedRelationId = vndbRelationId.trim().toLowerCase()
    if (normalizedRelationId) {
      const existPatch = await runCreateStep(
        'checkVndbRelationDuplicate',
        { uid, name, vndbRelationId: normalizedRelationId },
        () =>
          prisma.patch.findFirst({
            where: { vndb_relation_id: normalizedRelationId }
          })
      )
      if (existPatch) {
        return `该 Release ID 已存在 (游戏 ID: ${existPatch.unique_id}), Release ID 不可重复`
      }
    }
  }

  const galgameUniqueId = crypto.randomBytes(4).toString('hex')

  const normalizedDlsiteCode = dlsiteCode?.trim()
    ? dlsiteCode.trim().toUpperCase()
    : ''
  if (normalizedDlsiteCode) {
    const dlsitePatch = await runCreateStep(
      'checkDlsiteDuplicate',
      { uid, name, dlsiteCode: normalizedDlsiteCode },
      () =>
        prisma.patch.findFirst({
          where: { dlsite_code: normalizedDlsiteCode }
        })
    )
    if (dlsitePatch) {
      return `Galgame DLSite Code 与游戏 ID 为 ${dlsitePatch.unique_id} 的游戏重复`
    }
  }

  const submittedExternalData: SubmittedExternalData = {
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
  }

  const baseContext = { uid, uniqueId: galgameUniqueId, name }
  let patchId: number | null = null
  let uploadedKeys: string[] = []
  let externalDataResult: ProcessSubmittedExternalDataResult = {
    tagCachesChanged: false,
    companyCachesChanged: false
  }

  try {
    const createdPatch = await runCreateStep(
      'createPublishingPatch',
      baseContext,
      () =>
        prisma.$transaction(
          (tx) =>
            tx.patch.create({
              data: {
                name,
                unique_id: galgameUniqueId,
                vndb_id: vndbId ? vndbId : null,
                vndb_relation_id: vndbRelationId ? vndbRelationId : null,
                bangumi_id: bangumiId ? Number(bangumiId) : null,
                steam_id: steamId ? Number(steamId) : null,
                dlsite_code: normalizedDlsiteCode ? normalizedDlsiteCode : null,
                introduction,
                official_url: officialUrl || '',
                user_id: uid,
                banner: '',
                status: PATCH_STATUS_PUBLISHING,
                released,
                content_limit: contentLimit
              }
            }),
          { timeout: 60000 }
        )
    )
    const newPatchId = createdPatch.id
    patchId = newPatchId

    const patchContext = { ...baseContext, patchId: newPatchId }
    const bannerResult = await runCreateStep(
      'uploadPatchBanner',
      patchContext,
      () => uploadPatchBanner(banner, newPatchId, bannerOriginal)
    )
    if (typeof bannerResult === 'string') {
      console.error('[EditCreate] create failed at uploadPatchBanner', {
        ...patchContext,
        reason: bannerResult
      })
      await cleanupFailedCreateArtifacts(patchId, uploadedKeys, patchContext)
      return bannerResult
    }
    const uploadResult: PatchBannerUploadResult = bannerResult
    uploadedKeys = uploadResult.uploadedKeys

    const preparedExternalData: PreparedSubmittedExternalData =
      await runCreateStep(
        'prepareSubmittedExternalData',
        patchContext,
        () => prepareSubmittedExternalDataForCreate(submittedExternalData, uid)
      )

    externalDataResult = await runCreateStep(
      'finalizePublishTransaction',
      patchContext,
      () =>
        prisma.$transaction(
          async (tx) => {
            await runCreateStep('createRatingStat', patchContext, () =>
              tx.patch_rating_stat.create({
                data: { patch_id: newPatchId }
              })
            )

            if (alias.length) {
              const aliasData = alias.map((name) => ({
                name,
                patch_id: newPatchId
              }))
              await runCreateStep('createAliases', patchContext, () =>
                tx.patch_alias.createMany({
                  data: aliasData,
                  skipDuplicates: true
                })
              )
            }

            const processResult = await runCreateStep(
              'processSubmittedExternalData',
              patchContext,
              () =>
                processSubmittedExternalDataForCreate(
                  tx,
                  newPatchId,
                  submittedExternalData,
                  tag,
                  uid,
                  preparedExternalData
                )
            )

            await runCreateStep('updateUserReward', patchContext, () =>
              tx.user.update({
                where: { id: uid },
                data: {
                  daily_image_count: { increment: 1 },
                  moemoepoint: { increment: 3 }
                }
              })
            )

            await runCreateStep('publishPatch', patchContext, () =>
              tx.patch.update({
                where: { id: newPatchId },
                data: {
                  banner: uploadResult.imageLink,
                  status: PATCH_STATUS_VISIBLE
                }
              })
            )

            return processResult
          },
          { timeout: 60000 }
        )
    )
  } catch (error) {
    await cleanupFailedCreateArtifacts(patchId, uploadedKeys, {
      ...baseContext,
      patchId
    })
    throw error
  }

  if (!patchId) {
    throw new Error('Create publish completed without patch id')
  }

  const patchContext = { ...baseContext, patchId }

  if (externalDataResult.tagCachesChanged) {
    await runCreateStep('invalidateTagCaches', patchContext, () =>
      invalidateTagCaches()
    )
  }

  if (externalDataResult.companyCachesChanged) {
    await runCreateStep('invalidateCompanyCaches', patchContext, () =>
      invalidateCompanyCaches()
    )
  }

  try {
    await invalidatePatchListCaches()
  } catch (error) {
    logCreateStepError('invalidatePatchListCaches', error, {
      uid,
      patchId,
      uniqueId: galgameUniqueId,
      name
    })
    throw error
  }

  if (contentLimit === 'sfw') {
    const newPatchUrl = `${kunMoyuMoe.domain.main}/${galgameUniqueId}`
    await runBestEffortCreateStep('postToIndexNow', patchContext, () =>
      postToIndexNow(newPatchUrl)
    )
  }

  return { uniqueId: galgameUniqueId, patchId }
}
