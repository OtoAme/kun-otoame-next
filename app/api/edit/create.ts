import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { uploadPatchBanner, uploadPatchGalleryImage } from './_upload'
import { patchCreateSchema } from '~/validations/edit'
import { handleBatchPatchTags } from './batchTag'
import { kunMoyuMoe } from '~/config/moyu-moe'
import { postToIndexNow } from './_postToIndexNow'
import { ensurePatchCompaniesFromVNDB } from './fetchCompanies'

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
    galleryMetadata
  } = input

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

      if (gallery && galleryMetadata) {
        const metadata = JSON.parse(galleryMetadata) as {
          isNSFW: boolean
          watermark: boolean
        }[]
        const galleryFiles = Array.isArray(gallery) ? gallery : [gallery]

        for (let i = 0; i < galleryFiles.length; i++) {
          const file = galleryFiles[i] as File
          const meta = metadata[i]

          const galleryRecord = await prisma.patch_game_image.create({
            data: {
              patch_id: newId,
              url: '',
              is_nsfw: meta.isNSFW
            }
          })

          const arrayBuffer = await file.arrayBuffer()
          const uploadRes = await uploadPatchGalleryImage(
            arrayBuffer,
            newId,
            galleryRecord.id,
            meta.watermark
          )

          if (typeof uploadRes === 'string') {
            throw new Error(`Gallery upload failed: ${uploadRes}`)
          }

          const imageUrl = `${process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL}/patch/${newId}/gallery/${galleryRecord.id}.avif`

          await prisma.patch_game_image.update({
            where: { id: galleryRecord.id },
            data: { url: imageUrl }
          })
        }
      }

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

  return { uniqueId: galgameUniqueId }
}
