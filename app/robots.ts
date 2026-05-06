import { kunMoyuMoe } from '~/config/moyu-moe'
import type { MetadataRoute } from 'next'

const DISALLOW_PATHS = [
  '/message',
  '/admin',
  '/user',
  '/tag',
  '/*?page=',
  '/*&page='
]

export default function robots(): MetadataRoute.Robots {
  const sitemapUrl = new URL('/sitemap.xml', kunMoyuMoe.domain.main).toString()

  return {
    rules: [
      {
        userAgent: '*',
        disallow: DISALLOW_PATHS
      },
      {
        userAgent: 'Googlebot',
        disallow: DISALLOW_PATHS
      },
      {
        userAgent: 'Bingbot',
        disallow: DISALLOW_PATHS
      },
      {
        userAgent: 'Baiduspider',
        disallow: DISALLOW_PATHS
      }
    ],
    sitemap: sitemapUrl
  }
}
