import { kunMoyuMoe } from '~/config/moyu-moe'
import type { Metadata } from 'next'

const description = `萌萌点是 ${kunMoyuMoe.titleShort} 的社区积分。本页面说明萌萌点的获取途径、消费途径, 以及暂扣与结算规则。`

export const kunMetadata: Metadata = {
  title: '萌萌点规则',
  description,
  openGraph: {
    title: '萌萌点规则',
    description,
    type: 'website',
    images: kunMoyuMoe.images
  },
  twitter: {
    card: 'summary_large_image',
    title: '萌萌点规则',
    description
  },
  alternates: {
    canonical: `${kunMoyuMoe.domain.main}/moemoepoint/rules`
  }
}
