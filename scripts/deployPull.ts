import { execSync } from 'child_process'
import { config } from 'dotenv'
import { envSchema } from '../validations/dotenv-check'
import { fileURLToPath, URL } from 'url'
import { dirname } from 'path'
import * as fs from 'fs'
import * as path from 'path'
import https from 'https'
import { IncomingMessage } from 'http'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const envPath = path.resolve(__dirname, '..', '.env')
if (!fs.existsSync(envPath)) {
  console.error('.env file not found in the project root.')
  process.exit(1)
}

config({ path: envPath })

const downloadFile = (url: string, dest: string, headers: Record<string, string> = {}): Promise<void> => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { ...headers, 'User-Agent': 'Node.js' }
    }

    const request = https.get(options, (response: IncomingMessage) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        const newUrl = response.headers.location!
        const newUrlObj = new URL(newUrl)
        const newHeaders = { ...headers }
        // If redirecting to a different domain (e.g. S3), do NOT pass the Authorization header
        if (newUrlObj.hostname !== urlObj.hostname) {
          delete newHeaders['Authorization']
        }
        downloadFile(newUrl, dest, newHeaders).then(resolve).catch(reject)
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    })
    request.on('error', (err) => {
      fs.unlink(dest, () => reject(err))
    })
  })
}

const getLatestReleaseUrl = async (repo: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'User-Agent': 'Node.js' }
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`
    }

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      headers
    }
    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`))
          return
        }
        try {
          const release = JSON.parse(data)
          const asset = release.assets.find((a: any) => a.name === 'release.tar.gz')
          if (!asset) reject(new Error('No release.tar.gz found in latest release'))

          // If the asset url is different (e.g. for private repos it might be an api url),
          // we might need to handle it.
          // For private repos, browser_download_url is usually a redirect to S3/etc.
          // But if we use the API to get the asset, we might need to use 'Accept: application/octet-stream'
          // However, browser_download_url usually works with a token?
          // Actually for private repos, browser_download_url requires authentication if accessed directly?
          // Or maybe we should use the asset.url with 'Accept: application/octet-stream'.

          // Let's stick to browser_download_url for now. If it's private, the redirect might need the token?
          // Usually browser_download_url is a public link (S3 signed url) if you are authenticated to get the JSON?
          // No, for private repos, browser_download_url redirects to a signed URL.
          // But to get the redirect, you need the token if you hit the API endpoint?
          // Wait, browser_download_url IS the link.
          // If I curl browser_download_url with token, it redirects.

          resolve(asset.browser_download_url)
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

const main = async () => {
  try {
    envSchema.safeParse(process.env)
    const repo = process.env.GITHUB_REPO
    if (!repo) {
      console.error('GITHUB_REPO not set in .env')
      process.exit(1)
    }

    console.log('Fetching latest release URL...')
    const url = await getLatestReleaseUrl(repo)
    console.log(`Downloading from ${url}...`)

    const tempDir = path.resolve(__dirname, '..', '.next_temp')
    const tarPath = path.resolve(__dirname, '..', 'release.tar.gz')

    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
    fs.mkdirSync(tempDir)

    const headers: Record<string, string> = {}
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`
    }
    await downloadFile(url, tarPath, headers)

    console.log('Extracting release...')
    execSync(`tar -xzf ${tarPath} -C ${tempDir}`, { stdio: 'inherit' })

    // Update Prisma Schema and Generate Client for Target Architecture
    const tempPrismaDir = path.join(tempDir, 'prisma')
    const rootPrismaDir = path.resolve(__dirname, '..', 'prisma')

    if (fs.existsSync(tempPrismaDir)) {
      console.log('Updating Prisma schema...')
      if (fs.existsSync(rootPrismaDir)) fs.rmSync(rootPrismaDir, { recursive: true, force: true })
      fs.renameSync(tempPrismaDir, rootPrismaDir)

      console.log('Generating Prisma Client for current architecture...')
      // This runs in the project root, using the root node_modules (which has prisma CLI)
      // It generates the client into <root>/node_modules/@prisma/client and .prisma/client
      execSync('pnpm prisma generate', { stdio: 'inherit' })

      console.log('Injecting generated Prisma Client into standalone build...')
      // We need to copy the freshly generated client into the standalone node_modules
      // because the standalone app uses its own bundled node_modules
      const rootNodeModules = path.resolve(__dirname, '..', 'node_modules')
      const standaloneNodeModules = path.join(tempDir, 'node_modules')

      const copyPackage = (pkgName: string) => {
        const src = path.join(rootNodeModules, pkgName)
        const dest = path.join(standaloneNodeModules, pkgName)
        if (fs.existsSync(src)) {
          if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          // Use dereference: true to copy the actual content of symlinks (e.g. from .pnpm store)
          fs.cpSync(src, dest, { recursive: true, dereference: true })
        }
      }

      copyPackage('.prisma')
      copyPackage('@prisma')
    }

    console.log('Applying atomic update...')
    const nextDir = path.resolve(__dirname, '..', '.next')
    const standaloneDir = path.join(nextDir, 'standalone')
    if (!fs.existsSync(nextDir)) fs.mkdirSync(nextDir)

    // Note: We are replacing the directory. Any running process with this CWD will be in a "deleted" state.
    // We must ensure PM2 restarts the process from the new directory.
    if (fs.existsSync(standaloneDir)) fs.rmSync(standaloneDir, { recursive: true, force: true })

    fs.renameSync(tempDir, standaloneDir)
    fs.unlinkSync(tarPath)

    console.log('Running database migrations...')
    execSync('pnpm prisma db push', { stdio: 'inherit' })

    console.log('Reloading application...')
    // Use delete + start to ensure the process picks up the new CWD (fixing uv_cwd error)
    // "startOrReload" might reuse the old process context or fail if CWD is gone
    try {
      execSync('pm2 delete kun-touchgal-next', { stdio: 'inherit' })
    } catch (e) {
      // Ignore error if process doesn't exist
    }

    // Detect which server script exists in the new standalone directory
    const serverMjsPath = path.join(standaloneDir, 'server.mjs')
    const serverJsPath = path.join(standaloneDir, 'server.js')
    const scriptName = fs.existsSync(serverMjsPath) ? 'server.mjs' : 'server.js'

    console.log(`Starting PM2 with script: ${scriptName}`)
    execSync(
      `pm2 start ${scriptName} --name kun-touchgal-next --cwd "${standaloneDir}" -i 3 --max-memory-restart 1G -- --port 3000 --hostname 127.0.0.1`,
      { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } }
    )

    console.log('Deployment successful!')
  } catch (e) {
    console.error('Deployment failed:', e)
    process.exit(1)
  }
}

main()
