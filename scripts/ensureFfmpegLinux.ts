import { createWriteStream } from 'node:fs'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { get } from 'node:https'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { execSync } from 'node:child_process'
import { platform } from 'node:os'

const FFMPEG_DIR = join(process.cwd(), 'node_modules', '.ffmpeg')
const FFMPEG_BIN = join(FFMPEG_DIR, 'ffmpeg')

const BTBN_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz'

const main = async () => {
  if (platform() !== 'linux') {
    console.log(
      'Skipping animated AVIF ffmpeg setup (platform: %s, uses ffmpeg-static)',
      platform()
    )
    process.exit(0)
  }

  try {
    await import('fs').then((m) => m.promises.stat(FFMPEG_BIN))
    console.log('Animated AVIF ffmpeg already installed at %s', FFMPEG_BIN)
    process.exit(0)
  } catch {
    // Not installed yet, proceed
  }

  console.log('Downloading animated AVIF-capable ffmpeg for Linux...')
  console.log('Source: %s', BTBN_URL)

  const tmpDir = join(tmpdir(), 'otoame-ffmpeg-' + Date.now())
  const tarPath = join(tmpDir, 'ffmpeg.tar.xz')

  try {
    await mkdir(tmpDir, { recursive: true })

    // Download
    await new Promise<void>((resolve, reject) => {
      const file = createWriteStream(tarPath)
      get(BTBN_URL, { headers: { 'User-Agent': 'otoame-deploy' } }, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          // Follow redirect
          get(
            res.headers.location,
            { headers: { 'User-Agent': 'otoame-deploy' } },
            (redirectRes) => {
              pipeline(redirectRes, file)
                .then(resolve)
                .catch(reject)
            }
          ).on('error', reject)
          return
        }
        pipeline(res, file).then(resolve).catch(reject)
      }).on('error', reject)
    })

    // Extract
    execSync('tar -xJf  + tarPath +  -C  + tmpDir + ', {
      stdio: 'pipe'
    })

    // Find the ffmpeg binary inside the extracted directory
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(tmpDir)
    const rootDir = entries.find((e) => e.startsWith('ffmpeg-'))
    if (!rootDir) {
      throw new Error('Could not find ffmpeg binary in extracted archive')
    }

    const srcBin = join(tmpDir, rootDir, 'bin', 'ffmpeg')
    await mkdir(FFMPEG_DIR, { recursive: true })
    const { rename } = await import('node:fs/promises')
    await rename(srcBin, FFMPEG_BIN)
    await chmod(FFMPEG_BIN, 0o755)

    console.log(
      'Animated AVIF ffmpeg installed to %s',
      FFMPEG_BIN
    )
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error('Failed to set up animated AVIF ffmpeg:', err.message)
  console.error(
    'Animated AVIF thumbnails will fall back to still first-frame on this server.'
  )
  process.exit(0) // Non-fatal: let install continue
})
