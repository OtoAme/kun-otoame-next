import { uniqueTrimmed } from '~/app/api/edit/companyEnsureHelper'
import { markdownToHtmlExtend } from '~/app/api/utils/render/markdownToHtmlExtend'
import { applySteamOfficialUrlFallback } from '~/utils/externalIds'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

export interface PatchSubmissionPublishAssetInput {
  id?: number
  key: string
  thumbnailKey: string | null
  isNSFW: boolean
  displayOrder: number
}

export interface PatchSubmissionPublishProjection {
  name: string
  introduction: string
  aliases: string[]
  tagNames: string[]
  companyNames: string[]
  officialUrl: string
  released: string
  contentLimit: string
}

export interface PatchSubmissionPublishPreview
  extends PatchSubmissionPublishProjection {
  introductionHtml: string
  externalIds: {
    vndbId: string
    vndbRelationId: string
    bangumiId: string
    steamId: string
    dlsiteCode: string
  }
  bannerUrl: string | null
  bannerOriginalUrl: string | null
  gallery: {
    id?: number
    imageUrl: string | null
    thumbnailUrl: string | null
    isNSFW: boolean
    displayOrder: number
  }[]
}

export const projectPatchSubmissionPayload = (
  payload: PatchSubmissionPayload
): PatchSubmissionPublishProjection => ({
  name: payload.name,
  introduction: payload.introduction,
  aliases: uniqueTrimmed([...payload.alias, ...payload.steamAliases]),
  tagNames: uniqueTrimmed([
    ...payload.tag,
    ...payload.vndbTags,
    ...payload.bangumiTags,
    ...payload.steamTags
  ]),
  companyNames: uniqueTrimmed([
    ...payload.vndbDevelopers,
    ...payload.bangumiDevelopers,
    ...payload.steamDevelopers,
    payload.dlsiteCircleName
  ]),
  officialUrl: applySteamOfficialUrlFallback(
    payload.officialUrl,
    payload.steamId
  ),
  released: payload.released || 'unknown',
  contentLimit: payload.contentLimit
})

export const buildPatchSubmissionPublishedAssetUrl = (key: string | null) => {
  if (!key) return null
  const base = process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL?.replace(/\/+$/, '')
  return base ? `${base}/${key}` : null
}

/**
 * The author preview and reviewer detail both render this DTO. Publishing uses
 * the same projection for every merged field, so the preview cannot silently
 * drift from the row that approval creates.
 */
export const buildPatchSubmissionPublishPreview = async (input: {
  payload: PatchSubmissionPayload
  bannerKey: string | null
  bannerOriginalKey: string | null
  gallery: PatchSubmissionPublishAssetInput[]
}): Promise<PatchSubmissionPublishPreview> => {
  const projection = projectPatchSubmissionPayload(input.payload)

  return {
    ...projection,
    introductionHtml: await markdownToHtmlExtend(projection.introduction),
    externalIds: {
      vndbId: input.payload.vndbId,
      vndbRelationId: input.payload.vndbRelationId,
      bangumiId: input.payload.bangumiId,
      steamId: input.payload.steamId,
      dlsiteCode: input.payload.dlsiteCode
    },
    bannerUrl: buildPatchSubmissionPublishedAssetUrl(input.bannerKey),
    bannerOriginalUrl: buildPatchSubmissionPublishedAssetUrl(
      input.bannerOriginalKey
    ),
    gallery: input.gallery.map((image) => ({
      ...(image.id ? { id: image.id } : {}),
      imageUrl: buildPatchSubmissionPublishedAssetUrl(image.key),
      thumbnailUrl: buildPatchSubmissionPublishedAssetUrl(image.thumbnailKey),
      isNSFW: image.isNSFW,
      displayOrder: image.displayOrder
    }))
  }
}
