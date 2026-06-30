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

export interface PrivateMessageReplyPreview {
  messageId: number
  content: string
  senderName: string
  selectedText: string | null
}

export interface PrivateMessage {
  id: number
  type: number
  content: string
  status: number
  isDeleted: boolean
  image: PrivateMessageImage | null
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
