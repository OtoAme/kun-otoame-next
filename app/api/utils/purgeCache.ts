import { purgeCloudflareCache } from './purgeCloudflareCache'

export const purgePatchBannerCache = async (patchId: number) => {
  const imageBedUrl = process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL
  const patchBannerUrl = `${imageBedUrl}/patch/${patchId}/banner/banner.avif`
  const patchBannerMiniUrl = `${imageBedUrl}/patch/${patchId}/banner/banner-mini.avif`
  const patchBannerFullUrl = `${imageBedUrl}/patch/${patchId}/banner/banner-full.avif`

  return await purgeCloudflareCache([
    patchBannerUrl,
    patchBannerMiniUrl,
    patchBannerFullUrl
  ])
}

export const purgeUserAvatarCache = async (uid: number) => {
  const imageBedUrl = process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL
  const avatarUrl = `${imageBedUrl}/user/avatar/user_${uid}/avatar.avif`
  const avatarMiniUrl = `${imageBedUrl}/user/avatar/user_${uid}/avatar-mini.avif`

  return await purgeCloudflareCache([avatarUrl, avatarMiniUrl])
}
