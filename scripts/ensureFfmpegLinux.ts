import { createWriteStream } from 'node:fs'
import { chmod, mkdir, rm, stat } from 'node:fs/promises'
import { get } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { execSync } from 'node:child_process'
import { arch, platform } from 'node:os'

const FFMPEG_DIR = join(process.cwd(), 'node_modules', '.ffmpeg')
const FFMPEG_BIN = join(FFMPEG_DIR, 'ffmpeg')

const getBtbNAssetName = () => {
  if (arch() === 'x64') {
    return 'ffmpeg-master-latest-linux64-gpl.tar.xz'
  }

  if (arch() === 'arm64') {
    return 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz'
  }

  return null
}

const getBtbNUrl = () => {
  const assetName = getBtbNAssetName()
  return assetName
    ? 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/' +
        assetName
    : null
}

const main = async () => {
  if (platform() !== 'linux') {
    console.log(
      'Skipping animated AVIF ffmpeg setup (platform: %s, uses ffmpeg-static)',
      platform()
    )
    process.exit(0)
  }

  const btbNUrl = getBtbNUrl()
  if (!btbNUrl) {
    console.log(
      'Skipping animated AVIF ffmpeg setup (unsupported Linux arch: %s)',
      arch()
    )
    process.exit(0)
  }

  try {
    await stat(FFMPEG_BIN)
    console.log('Animated AVIF ffmpeg already installed at %s', FFMPEG_BIN)
    process.exit(0)
  } catch {
    // Not installed yet, proceed
  }

  console.log('Downloading animated AVIF-capable ffmpeg for Linux...')
  console.log('Source: %s', btbNUrl)

  const tmpDir = join(tmpdir(), 'otoame-ffmpeg-' + Date.now())
  const tarPath = join(tmpDir, 'ffmpeg.tar.xz')

  try {
    await mkdir(tmpDir, { recursive: true })

    // Download
    await new Promise<void>((resolve, reject) => {
      const file = createWriteStream(tarPath)
      get(btbNUrl, { headers: { 'User-Agent': 'otoame-deploy' } }, (res) => {
        const follow = (r: typeof res) => {
          if (
            r.statusCode &&
            r.statusCode >= 300 &&
            r.statusCode < 400 &&
            r.headers.location
          ) {
            get(
              r.headers.location,
              { headers: { 'User-Agent': 'otoame-deploy' } },
              (rr) => follow(rr)
            ).on('error', reject)
            return
          }

          if (r.statusCode !== 200) {
            reject(new Error('download failed with status ' + r.statusCode))
            return
          }

          pipeline(r, file).then(resolve).catch(reject)
        }
        follow(res)
      }).on('error', reject)
    })

    // Extract
    execSync(`tar -xJf "${tarPath}" -C "${tmpDir}"`, { stdio: 'pipe' })

    // Find the ffmpeg binary inside the extracted directory
    const { readdir, rename } = await import('node:fs/promises')
    const entries = await readdir(tmpDir)
    const rootDir = entries.find((e) => e.startsWith('ffmpeg-'))
    if (!rootDir) {
      throw new Error('Could not find ffmpeg binary in extracted archive')
    }

    const srcBin = join(tmpDir, rootDir, 'bin', 'ffmpeg')
    await mkdir(FFMPEG_DIR, { recursive: true })
    await rename(srcBin, FFMPEG_BIN)
    await chmod(FFMPEG_BIN, 0o755)

    console.log('Animated AVIF ffmpeg installed to %s', FFMPEG_BIN)
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error('Failed to set up animated AVIF ffmpeg:', err.message)
  console.error(
    'Animated AVIF thumbnails will fall back to still first-frame on this server.'
  )
  process.exit(0)
})
