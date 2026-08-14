import { prisma } from '~/prisma/index'
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
  price: number
  status: number
  is_builtin?: boolean
}

export type StickerRecord = {
  id: string
  pack_id: number
  alt: string
  asset_url: string
  thumbnail_url: string | null
  storage_key: string
  thumbnail_storage_key: string | null
  mime: string
  media_type: string
  width: number
  height: number
  size: number
  duration_ms: number | null
  frame_rate: number | null
  sort_order: number
  pack?: StickerPackRecord
}

export const mapSticker = (
  sticker: StickerRecord | null | undefined,
  packOverride?: StickerPackRecord
): PrivateMessageSticker | null => {
  const pack = sticker?.pack ?? packOverride
  if (!sticker || !pack || !sticker.asset_url) {
    return null
  }

  const mediaType = sticker.media_type === 'video' ? 'video' : 'image'

  return {
    id: sticker.id,
    packId: sticker.pack_id,
    packSlug: pack.slug,
    packName: pack.name,
    url: sticker.asset_url,
    thumbnailUrl:
      sticker.thumbnail_url ??
      (mediaType === 'image' ? sticker.asset_url : null),
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
  pack: StickerPackRecord & { stickers: StickerRecord[] }
): StickerPack => {
  const stickers = pack.stickers
    .map((sticker) => mapSticker(sticker, pack)!)
    .filter(Boolean)

  return {
    id: pack.id,
    slug: pack.slug,
    name: pack.name,
    description: pack.description,
    coverUrl: pack.cover_url ?? stickers[0]?.thumbnailUrl ?? null,
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
      stickers: {
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

  if (sticker.pack.status !== STICKER_PACK_ACTIVE) {
    return '贴纸包已下架，暂时无法发送'
  }

  if (!sticker.pack.is_builtin) {
    return '当前阶段仅支持内置贴纸包'
  }

  return sticker as unknown as StickerRecord
}
