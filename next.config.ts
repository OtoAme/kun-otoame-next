import { fileURLToPath } from 'url'
import { env } from './validations/dotenv-check'
import createMDX from '@next/mdx'
import type { NextConfig } from 'next'
// import remarkGfm from 'remark-gfm'
// import rehypeSlug from 'rehype-slug'
// import rehypeAutolinkHeadings from 'rehype-autolink-headings'
// import rehypePrettyCode from 'rehype-pretty-code'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

const skipDeployBuildChecks =
  process.env.KUN_DEPLOY_BUILD_SKIP_CHECKS === 'true'

const nextConfig: NextConfig = {
  devIndicators: false,
  logging: {
    incomingRequests: {
      ignore: [
        /\/api\/message\/unread/,
        /\/api\/message\/conversation(?:\/|$)/
      ]
    }
  },
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  // 萌萌点明细从 /user/[id]/moemoepoint 迁到独立的 /moemoepoint 段,
  // 萌萌点排行整体下线。这两个旧路径都只存在于未提交的工作区, 大概率从未上线;
  // 但服务器支持本地构建, 保留 301 以防已经有人访问过。
  async redirects() {
    return [
      {
        source: '/ranking/moemoepoint',
        destination: '/moemoepoint',
        permanent: true
      },
      {
        source: '/user/:id/moemoepoint',
        destination: '/moemoepoint',
        permanent: true
      }
    ]
  },
  transpilePackages: ['next-mdx-remote'],
  serverExternalPackages: ['ffmpeg-static'],
  publicRuntimeConfig: {
    NODE_ENV: env.data!.NODE_ENV
  },
  eslint: {
    ignoreDuringBuilds: skipDeployBuildChecks
  },
  typescript: {
    ignoreBuildErrors: skipDeployBuildChecks
  },
  sassOptions: {
    silenceDeprecations: ['legacy-js-api']
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 7,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: env.data!.KUN_VISUAL_NOVEL_IMAGE_BED_HOST,
        port: '',
        pathname: '/**'
      },
      {
        protocol: 'https',
        hostname: 'cloud.touchgaloss.com',
        port: '',
        pathname: '/**'
      }
    ]
  },

  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  experimental: {
    optimizePackageImports: ['@heroui/react', 'lucide-react', 'date-fns'],
    staticGenerationMaxConcurrency: 2,
    staticGenerationMinPagesPerWorker: 10,
    staticGenerationRetryCount: 1
    // turbotrace: {
    //   logLevel: 'error',
    //   logDetail: false,
    //   contextDirectory: path.join(__dirname, '/'),
    //   memoryLimit: 1024
    // }
  }
}

// Turbopack compatible errors
const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    // remarkPlugins: [remarkGfm],
    rehypePlugins: [
      // rehypeSlug,
      // [
      //   rehype - autolink - headings,
      //   {
      //     properties: {
      //       className: ['anchor'],
      //     },
      //   },
      // ],
      // [
      //   rehypePrettyCode,
      //   {
      //     theme: 'github-dark',
      //   },
      // ],
    ]
  }
})

export default withMDX(nextConfig)
