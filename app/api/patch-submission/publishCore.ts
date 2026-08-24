import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { kunMoyuMoe } from '~/config/moyu-moe'
import { postToIndexNow } from '~/app/api/edit/_postToIndexNow'
import {
  invalidateCompanyCaches,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import {
  buildTagLookupWhere,
  mapTagNamesToIds
} from '~/app/api/edit/tagEnsureHelper'
import {
  ensureCompanyRelationsByName,
  uniqueTrimmed,
  type CompanyCreateInput
} from '~/app/api/edit/companyEnsureHelper'
import { applySteamOfficialUrlFallback } from '~/utils/externalIds'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

type Tx = Prisma.TransactionClient

export interface PublishAsset {
  /** Key of an object that already exists; publishing never moves objects. */
  key: string
  thumbnailKey: string | null
  isNSFW: boolean
  displayOrder: number
}

export interface PublishCoreInput {
  authorId: number
  payload: PatchSubmissionPayload
  bannerKey: string | null
  gallery: PublishAsset[]
}

/**
 * Everything the publish transaction touches, and nothing else.
 *
 * The direct-publish path runs its tag and company work *after* the transaction
 * (app/api/edit/create.ts calls processSubmittedExternalData once the patch is
 * already visible), and that helper also reaches out to VNDB. Neither is
 * acceptable here: approval must not touch the network, and an entry must never
 * become public with half its relations missing. So relations are written inside
 * the transaction from the frozen snapshot, and only cache invalidation and
 * IndexNow are left for afterwards.
 */
export const publishSubmissionCore = async (tx: Tx, input: PublishCoreInput) => {
  const { payload } = input
  const uniqueId = crypto.randomBytes(4).toString('hex')

  const patch = await tx.patch.create({
    data: {
      name: payload.name,
      unique_id: uniqueId,
      vndb_id: payload.vndbId || null,
      vndb_relation_id: payload.vndbRelationId || null,
      bangumi_id: payload.bangumiId ? Number(payload.bangumiId) : null,
      steam_id: payload.steamId ? Number(payload.steamId) : null,
      dlsite_code: payload.dlsiteCode || null,
      introduction: payload.introduction,
      official_url: applySteamOfficialUrlFallback(
        payload.officialUrl,
        payload.steamId
      ),
      user_id: input.authorId,
      banner: input.bannerKey
        ? `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/${input.bannerKey}`
        : '',
      released: payload.released || 'unknown',
      content_limit: payload.contentLimit
    },
    select: { id: true, unique_id: true }
  })

  await tx.patch_rating_stat.create({ data: { patch_id: patch.id } })

  const aliases = uniqueTrimmed([...payload.alias, ...payload.steamAliases])
  if (aliases.length) {
    await tx.patch_alias.createMany({
      data: aliases.map((name) => ({ name, patch_id: patch.id })),
      skipDuplicates: true
    })
  }

  const tagNames = uniqueTrimmed([
    ...payload.tag,
    ...payload.vndbTags,
    ...payload.bangumiTags,
    ...payload.steamTags
  ])
  if (tagNames.length) {
    const existingTags = await tx.patch_tag.findMany({
      where: buildTagLookupWhere(tagNames),
      orderBy: { id: 'asc' }
    })
    const nameToId = mapTagNamesToIds(existingTags)

    const missing = tagNames.filter((name) => !nameToId.has(name))
    if (missing.length) {
      await tx.patch_tag.createMany({
        data: missing.map((name) => ({
          name,
          introduction: '',
          alias: [],
          user_id: input.authorId
        })),
        skipDuplicates: true
      })
      const created = await tx.patch_tag.findMany({
        where: { name: { in: missing } },
        select: { id: true, name: true, alias: true }
      })
      for (const tag of created) {
        nameToId.set(tag.name, tag.id)
      }
    }

    const tagIds = [...new Set(tagNames.map((name) => nameToId.get(name)))].filter(
      (id): id is number => typeof id === 'number'
    )
    if (tagIds.length) {
      await tx.patch_tag_relation.createMany({
        data: tagIds.map((tagId) => ({ patch_id: patch.id, tag_id: tagId })),
        skipDuplicates: true
      })
      await tx.patch_tag.updateMany({
        where: { id: { in: tagIds } },
        data: { count: { increment: 1 } }
      })
    }
  }

  const companyNames = uniqueTrimmed([
    ...payload.vndbDevelopers,
    ...payload.bangumiDevelopers,
    ...payload.steamDevelopers,
    payload.dlsiteCircleName
  ])
  if (companyNames.length) {
    const companiesByName = new Map<string, CompanyCreateInput>(
      companyNames.map((name) => [
        name,
        {
          name,
          introduction: '',
          alias: [],
          official_website:
            name === payload.dlsiteCircleName && payload.dlsiteCircleLink
              ? [payload.dlsiteCircleLink]
              : [],
          user_id: input.authorId
        }
      ])
    )
    await ensureCompanyRelationsByName(tx, patch.id, companiesByName)
  }

  if (input.gallery.length) {
    await tx.patch_game_image.createMany({
      data: input.gallery.map((image) => ({
        patch_id: patch.id,
        url: `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/${image.key}`,
        thumbnail_url: image.thumbnailKey
          ? `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/${image.thumbnailKey}`
          : null,
        is_nsfw: image.isNSFW,
        display_order: image.displayOrder
      }))
    })
  }

  return patch
}

/**
 * Runs after the transaction commits. A failure here only leaves a cache stale,
 * so it is logged and swallowed rather than rolling back a published entry.
 */
export const runPublishSideEffects = async (input: {
  uniqueId: string
  contentLimit: string
  touchedCompanies: boolean
}) => {
  try {
    await invalidatePatchListCaches()
    if (input.touchedCompanies) {
      await invalidateCompanyCaches()
    }
  } catch (error) {
    console.error('Failed to invalidate caches after publishing a submission', {
      uniqueId: input.uniqueId,
      error
    })
  }

  if (input.contentLimit === 'sfw') {
    try {
      await postToIndexNow(`${kunMoyuMoe.domain.main}/${input.uniqueId}`)
    } catch (error) {
      console.error('Failed to notify IndexNow after publishing a submission', {
        uniqueId: input.uniqueId,
        error
      })
    }
  }
}
