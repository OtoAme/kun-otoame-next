import { kunMoyuMoe } from '~/config/moyu-moe'
import type { Metadata } from 'next'

const title = '私聊'
const description = `这是 ${kunMoyuMoe.titleShort} 私聊页面, 可以查看和发送站内私聊消息`

export const privateChatMetadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: 'website',
    siteName: kunMoyuMoe.titleShort,
    images: kunMoyuMoe.images
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    creator: kunMoyuMoe.creator.mention,
    images: kunMoyuMoe.og.image
  },
  alternates: {
    canonical: `${kunMoyuMoe.domain.main}/message/chat`
  }
}
