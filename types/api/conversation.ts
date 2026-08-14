export interface Conversation {
  id: number
  otherUser: KunUser
  lastMessage: string
  lastMessageTime: string | Date
  unreadCount: number
}

export interface PrivateMessageImage {
  url: string
  width: number
  height: number
  size: number
  mime: string
  name: string
}

export type StickerMediaType = 'image' | 'video'

export interface PrivateMessageSticker {
  id: string
  packId: number
  packSlug: string
  packName: string
  url: string
  thumbnailUrl: string | null
  mime: string
  mediaType: StickerMediaType
  width: number
  height: number
  size: number
  durationMs: number | null
  frameRate: number | null
  alt: string
}

export interface StickerPack {
  id: number
  slug: string
  name: string
  description: string
  coverUrl: string | null
  price: number
  status: number
  stickers: PrivateMessageSticker[]
}

export interface StickerPacksResponse {
  packs: StickerPack[]
}

export interface PrivateMessageReplyPreview {
  messageId: number
  content: string
  senderName: string
  selectedText: string | null
  image?: PrivateMessageImage | null
  stickerId?: string | null
  sticker?: PrivateMessageSticker | null
}

export interface PrivateMessage {
  id: number
  type: number
  content: string
  status: number
  isDeleted: boolean
  image: PrivateMessageImage | null
  images?: PrivateMessageImage[]
  stickerId?: string | null
  sticker?: PrivateMessageSticker | null
  replyTo: PrivateMessageReplyPreview | null
  editedAt: string | Date | null
  created: string | Date
  sender: KunUser
}

export interface ConversationMessagesResponse {
  messages: PrivateMessage[]
  total: number
  hasMoreBefore: boolean
  otherUser: KunUser
}
