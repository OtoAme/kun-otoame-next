export const purgePatchBannerCache = async (patchId: number) => {
    const imageBedUrl = process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL
    const patchBannerUrl = `${imageBedUrl}/patch/${patchId}/banner/banner.avif`
    const patchBannerMiniUrl = `${imageBedUrl}/patch/${patchId}/banner/banner-mini.avif`

    const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${process.env.KUN_CF_CACHE_ZONE_ID}/purge_cache`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.KUN_CF_CACHE_PURGE_API_TOKEN}`
            },
            body: JSON.stringify({
                files: [patchBannerUrl, patchBannerMiniUrl]
            })
        }
    )

    return { status: res.status }
}
