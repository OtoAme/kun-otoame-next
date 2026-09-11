import { kunMoyuMoe } from '~/config/moyu-moe'
import type { Metadata } from 'next'

export const kunMetadata: Metadata = {
  title: '发布 OtomeGame',
  description:
    '您需要创建一个新 OtomeGame, 稍后在 OtomeGame 页面添加下载资源, 如果已经有这个 OtomeGame 了, 直接在对应页面添加资源即可',
  openGraph: {
    title: '发布 OtomeGame',
    description:
      '您需要创建一个新 OtomeGame, 稍后在 OtomeGame 页面添加下载资源, 如果已经有这个 OtomeGame 了, 直接在对应页面添加资源即可',
    type: 'website',
    images: kunMoyuMoe.images
  },
  twitter: {
    card: 'summary_large_image',
    title: '发布 OtomeGame',
    description:
      '您需要创建一个新 OtomeGame, 稍后在 OtomeGame 页面添加下载资源, 如果已经有这个 OtomeGame 了, 直接在对应页面添加资源即可'
  },
  alternates: {
    canonical: `${kunMoyuMoe.domain.main}/edit/create`
  }
}
