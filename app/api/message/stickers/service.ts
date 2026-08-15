import { prisma } from '~/prisma/index'
import { getS3PublicUrl } from '~/lib/s3'
import type {
  PrivateMessageSticker,
  StickerPack,
  StickerPacksResponse
} from '~/types/api/conversation'

export const STICKER_PACK_ACTIVE = 1

type StickerPackRecord = {
  id: number
  slug: string
  name: string
  description: string
  cover_url: string | null
  cover_storage_key?: string | null
  cover_sticker_id?: string | null
  price: number
  status: number
  is_builtin?: boolean
}

export type StickerRecord = {
  id: string
  pack_id: number
  alt: string
  asset_url: string | null
  thumbnail_url: string | null
  storage_key: string
  thumbnail_storage_key: string | null
  mime: string
  media_type: string
  status?: number
  content_hash?: string | null
  width: number
  height: number
  size: number
  duration_ms: number | null
  frame_rate: number | null
  sort_order: number
  pack?: StickerPackRecord
}

const getStickerUrl = (
  legacyUrl: string | null | undefined,
  storageKey: string | null | undefined
) => legacyUrl || getS3PublicUrl(storageKey)

export const mapSticker = (
  sticker: StickerRecord | null | undefined,
  packOverride?: StickerPackRecord
): PrivateMessageSticker | null => {
  const pack = sticker?.pack ?? packOverride
  const assetUrl = getStickerUrl(sticker?.asset_url, sticker?.storage_key)
  if (!sticker || !pack || !assetUrl) {
    return null
  }

  const mediaType = sticker.media_type === 'video' ? 'video' : 'image'
  const thumbnailUrl = getStickerUrl(
    sticker.thumbnail_url,
    sticker.thumbnail_storage_key
  )

  return {
    id: sticker.id,
    packId: sticker.pack_id,
    packSlug: pack.slug,
    packName: pack.name,
    url: assetUrl,
    thumbnailUrl: thumbnailUrl ?? (mediaType === 'image' ? assetUrl : null),
    mime: sticker.mime,
    mediaType,
    width: sticker.width,
    height: sticker.height,
    size: sticker.size,
    durationMs: sticker.duration_ms,
    frameRate: sticker.frame_rate,
    alt: sticker.alt || pack.name
  }
}

const mapStickerPack = (
  pack: StickerPackRecord & {
    stickers: StickerRecord[]
    cover_sticker?: StickerRecord | null
  }
): StickerPack => {
  const stickers = pack.stickers
    .map((sticker) => mapSticker(sticker, pack)!)
    .filter(Boolean)
  const coverSticker = pack.cover_sticker
    ? mapSticker(pack.cover_sticker, pack)
    : null

  return {
    id: pack.id,
    slug: pack.slug,
    name: pack.name,
    description: pack.description,
    coverUrl:
      pack.cover_url ??
      getS3PublicUrl(pack.cover_storage_key) ??
      coverSticker?.thumbnailUrl ??
      stickers[0]?.thumbnailUrl ??
      null,
    price: pack.price,
    status: pack.status,
    stickers
  }
}

const loadStickerById = async (stickerId: string) =>
  prisma.sticker.findUnique({
    where: { id: stickerId },
    include: {
      pack: {
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          cover_url: true,
          cover_storage_key: true,
          cover_sticker_id: true,
          price: true,
          status: true,
          is_builtin: true
        }
      }
    }
  })

export const getStickerPacks = async (
  _uid: number
): Promise<StickerPacksResponse> => {
  const packs = await prisma.sticker_pack.findMany({
    where: {
      status: STICKER_PACK_ACTIVE,
      is_builtin: true
    },
    include: {
      cover_sticker: true,
      stickers: {
        where: { status: STICKER_PACK_ACTIVE },
        orderBy: { sort_order: 'asc' }
      }
    },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }]
  })

  return {
    packs: packs.map((pack) => mapStickerPack(pack))
  }
}

export const getStickerForSending = async (
  stickerId: string,
  _uid: number
): Promise<StickerRecord | string> => {
  const sticker = await loadStickerById(stickerId)
  if (!sticker) {
    return '贴纸不存在或已不可用'
  }

  if (sticker.status !== undefined && sticker.status !== STICKER_PACK_ACTIVE) {
    return '贴纸已禁用，暂时无法发送'
  }

  if (!sticker.asset_url && !sticker.storage_key) {
    return '贴纸资源不可用'
  }

  if (sticker.pack.status !== STICKER_PACK_ACTIVE) {
    return '贴纸包已禁用，暂时无法发送'
  }

  if (!sticker.pack.is_builtin) {
    return '当前阶段仅支持内置贴纸包'
  }

  return sticker as unknown as StickerRecord
}
