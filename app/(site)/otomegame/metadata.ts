import { kunMoyuMoe } from '~/config/moyu-moe'
import type { Metadata } from 'next'

const description =
  '收录女性向游戏 / 其他游戏资源下载与资料，涵盖 Otomate、Design Factory、Ruby Party、Rejet、Broccoli、honeybee、HuneX、Voltage、D3 Publisher 等知名乙女游戏品牌与会社。'

export const kunMetadata: Metadata = {
  title: '游戏下载',
  description,
  openGraph: {
    title: '游戏下载',
    description,
    type: 'website',
    images: kunMoyuMoe.images
  },
  twitter: {
    card: 'summary_large_image',
    title: '游戏下载',
    description
  },
  alternates: {
    canonical: `${kunMoyuMoe.domain.main}/otomegame`
  }
}
