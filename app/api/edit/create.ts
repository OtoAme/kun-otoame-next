import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { uploadPatchBanner, uploadPatchGalleryImage } from './_upload'
import { patchCreateSchema } from '~/validations/edit'
import { handleBatchPatchTags } from './batchTag'
import { kunMoyuMoe } from '~/config/moyu-moe'
import { postToIndexNow } from './_postToIndexNow'
import { ensurePatchCompaniesFromVNDB } from './fetchCompanies'
import { pLimit } from '~/utils/pLimit'

export const createGalgame = async (
  input: Omit<z.infer<typeof patchCreateSchema>, 'alias' | 'tag'> & {
    alias: string[]
    tag: string[]
  },
  uid: number
) => {
  const {
    name,
    vndbId,
    alias,
    banner,
    tag,
    introduction,
    released,
    contentLimit,
    gallery,
    galleryMetadata,
    isDuplicate
  } = input

  if (vndbId && isDuplicate !== 'true') {
    const existPatch = await prisma.patch.findFirst({
      where: { vndb_id: vndbId }
    })
    if (existPatch) {
      return '该游戏已存在, 请勿重复创建'
    }
  }

  const bannerArrayBuffer = banner as ArrayBuffer
  const galgameUniqueId = crypto.randomBytes(4).toString('hex')

  const res = await prisma.$transaction(
    async (prisma) => {
      const patch = await prisma.patch.create({
        data: {
          name,
          unique_id: galgameUniqueId,
          vndb_id: vndbId ? vndbId : null,
          introduction,
          user_id: uid,
          banner: '',
          released,
          content_limit: contentLimit
        }
      })

      const newId = patch.id

      const uploadResult = await uploadPatchBanner(bannerArrayBuffer, newId)
      if (typeof uploadResult === 'string') {
        return uploadResult
      }
      const timestamp = Date.now()
      const imageLink = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${newId}/banner/banner.avif?t=${timestamp}`

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
        data: {
          daily_image_count: { increment: 1 },
          moemoepoint: { increment: 3 }
        }
      })

      return { patchId: newId }
    },
    { timeout: 60000 }
  )

  if (typeof res === 'string') {
    return res
  }

  if (vndbId) {
    try {
      await ensurePatchCompaniesFromVNDB(res.patchId, vndbId, uid)
    } catch { }
  }

  if (tag.length) {
    await handleBatchPatchTags(res.patchId, tag, uid)
  }

  if (contentLimit === 'sfw') {
    const newPatchUrl = `${kunMoyuMoe.domain.main}/${galgameUniqueId}`
    await postToIndexNow(newPatchUrl)
  }

  // Background tasks for gallery upload
  if (gallery && galleryMetadata) {
    const metadata = JSON.parse(galleryMetadata) as {
      isNSFW: boolean
      watermark: boolean
    }[]
    const galleryFiles = Array.isArray(gallery) ? gallery : [gallery]
    const limit = pLimit(2)

    Promise.all(
      galleryFiles.map((file, i) =>
        limit(async () => {
          const meta = metadata[i]

          // 1. Create placeholder record
          const galleryRecord = await prisma.patch_game_image.create({
            data: {
              patch_id: res.patchId,
              url: '',
              is_nsfw: meta.isNSFW,
              display_order: i
            }
          })

          try {
            const arrayBuffer = await (file as File).arrayBuffer()
            const uploadRes = await uploadPatchGalleryImage(
              arrayBuffer,
              res.patchId,
              galleryRecord.id,
              meta.watermark
            )

            if (typeof uploadRes === 'string') {
              console.error(`Gallery upload failed: ${uploadRes}`)
              // Cleanup if upload fails
              await prisma.patch_game_image.delete({
                where: { id: galleryRecord.id }
              })
              return
            }

            const imageUrl = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${res.patchId}/gallery/${galleryRecord.id}.avif`

            // 2. Update record with actual URL
            await prisma.patch_game_image.update({
              where: { id: galleryRecord.id },
              data: { url: imageUrl }
            })
          } catch (error) {
            console.error('Gallery processing error:', error)
            // Cleanup on error
            await prisma.patch_game_image.delete({
              where: { id: galleryRecord.id }
            }).catch(() => { })
          }
        })
      )
    ).catch(console.error)
  }

  return { uniqueId: galgameUniqueId }
}
