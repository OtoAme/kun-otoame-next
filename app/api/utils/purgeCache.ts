import { purgeCloudflareCache } from './purgeCloudflareCache'
import { getImageBedUrl } from '~/lib/s3Url'

export const purgePatchBannerCache = async (patchId: number) => {
  const patchBannerUrl = getImageBedUrl(`patch/${patchId}/banner/banner.avif`)
  const patchBannerMiniUrl = getImageBedUrl(`patch/${patchId}/banner/banner-mini.avif`)
  const patchBannerFullUrl = getImageBedUrl(`patch/${patchId}/banner/banner-full.avif`)

  return await purgeCloudflareCache([
    patchBannerUrl,
    patchBannerMiniUrl,
    patchBannerFullUrl
  ])
}

export const purgeUserAvatarCache = async (uid: number) => {
  const avatarUrl = getImageBedUrl(`user/avatar/user_${uid}/avatar.avif`)
  const avatarMiniUrl = getImageBedUrl(`user/avatar/user_${uid}/avatar-mini.avif`)

  return await purgeCloudflareCache([avatarUrl, avatarMiniUrl])
}
