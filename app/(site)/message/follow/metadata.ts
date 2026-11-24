import { kunMoyuMoe } from '~/config/moyu-moe'
import type { Metadata } from 'next'

const description = '查看你关注的人新发布的游戏条目和资源。'

export const kunMetadata: Metadata = {
  title: '关注动态',
  description,
  openGraph: {
    title: '关注动态',
    description,
    type: 'website',
    images: kunMoyuMoe.images
  },
  twitter: {
    card: 'summary_large_image',
    title: '关注动态',
    description
  },
  alternates: {
    canonical: `${kunMoyuMoe.domain.main}/message/follow`
  }
}
