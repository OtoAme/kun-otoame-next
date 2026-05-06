import { writeFile } from 'fs/promises'
import { globby } from 'globby'
import prettier from 'prettier'
import { getKunDynamicPatches } from './dynamic-routes/getKunDynamicPatches'
import { getKunDynamicBlog } from './dynamic-routes/getKunDynamicBlog'
import { kunMoyuMoe } from '~/config/moyu-moe'

const WEBSITE_URL = new URL(kunMoyuMoe.domain.main).origin

const INDEXABLE_STATIC_ROUTES = new Set([
  '',
  '/comment',
  '/company',
  '/doc',
  '/friend-link',
  '/otomegame',
  '/ranking',
  '/resource'
])

const toRoute = (page: string) => {
  const path = page
    .replace('app', '')
    .replace('/page.tsx', '')
    .replace('.tsx', '')
  return path === '/index' ? '' : path
}

const toSitemapUrl = ({
  route,
  lastmod,
  changefreq,
  priority
}: {
  route: string
  lastmod: string
  changefreq: 'daily' | 'weekly'
  priority: '0.7' | '0.8' | '0.9'
}) => `
  <url>
    <loc>${WEBSITE_URL}${route}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>
`

const generateKunSitemap = async () => {
  try {
    const pages = await globby([
      'app/**/*.tsx',
      '!app/**/_*.tsx',
      '!app/**/layout.tsx',
      '!app/**/providers.tsx',
      '!app/**/loading.tsx',
      '!app/**/error.tsx',
      '!app/**/*.test.tsx',
      '!app/**/components/**',
      '!app/**/[id]/**',
      '!app/**/admin/**',
      '!app/**/edit/**',
      '!app/**/message/**',
      '!app/**/user/**',
      '!app/**/doc/**/**'
    ])

    const staticRoutes = pages
      .concat(['app/doc/page.tsx'])
      .map(toRoute)
      .filter((route) => INDEXABLE_STATIC_ROUTES.has(route))

    const dynamicPatches = await getKunDynamicPatches()
    const dynamicBlogs = getKunDynamicBlog()
    const generatedAt = new Date().toISOString()

    const sitemap = `
      <?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        ${staticRoutes
          .map((route) =>
            toSitemapUrl({
              route,
              lastmod: generatedAt,
              changefreq: 'daily',
              priority: '0.7'
            })
          )
          .join('')}
        ${dynamicPatches
          .map((patch) =>
            toSitemapUrl({
              route: patch.path,
              lastmod: patch.lastmod,
              changefreq: 'daily',
              priority: '0.8'
            })
          )
          .join('')}
          ${dynamicBlogs
            .map((patch) =>
              toSitemapUrl({
                route: patch.path,
                lastmod: patch.lastmod,
                changefreq: 'weekly',
                priority: '0.9'
              })
            )
            .join('')}
      </urlset>
    `

    const formatted = await prettier.format(sitemap, {
      parser: 'html'
    })

    await writeFile('public/sitemap.xml', formatted)
    console.log('✅ Sitemap generated successfully!')
  } catch (error) {
    console.error('Error generating sitemap:', error)
    process.exit(1)
  }
}

generateKunSitemap()
