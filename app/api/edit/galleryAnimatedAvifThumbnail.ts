import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const GALLERY_AVIF_THUMBNAIL_MAX_WIDTH = 360
const GALLERY_AVIF_THUMBNAIL_MAX_HEIGHT = 240
const GALLERY_AVIF_THUMBNAIL_TIMEOUT_MS = 15_000
const GALLERY_AVIF_THUMBNAIL_MAX_BYTES = 512 * 1024
const SYSTEM_FFMPEG_COMMAND = 'ffmpeg'
const require = createRequire(import.meta.url)

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const LINUX_FFMPEG_PATH = path.join(
  PROJECT_ROOT,
  'node_modules',
  '.ffmpeg',
  'ffmpeg'
)

const getBundledFfmpegPath = async () => {
  if (process.platform === 'linux' && existsSync(LINUX_FFMPEG_PATH)) {
    return LINUX_FFMPEG_PATH
  }

  try {
    const ffmpegStatic = require('ffmpeg-static') as unknown
    return typeof ffmpegStatic === 'string' ? ffmpegStatic : null
  } catch {
    return null
  }
}

export const getGalleryFfmpegCommands = async () => {
  const bundledPath = await getBundledFfmpegPath()
  return bundledPath
    ? [bundledPath, SYSTEM_FFMPEG_COMMAND]
    : [SYSTEM_FFMPEG_COMMAND]
}

const runCommand = (
  command: string,
  args: string[],
  timeoutMs = GALLERY_AVIF_THUMBNAIL_TIMEOUT_MS
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(command + ' timed out'))
    }, timeoutMs)

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(command + ' exited with code ' + code + ': ' + stderr))
    })
  })

const readGeneratedThumbnail = async (outputPath: string) => {
  const buffer = await readFile(outputPath)
  if (buffer.byteLength > GALLERY_AVIF_THUMBNAIL_MAX_BYTES) {
    throw new Error(
      'generated thumbnail is too large: ' + buffer.byteLength + ' bytes'
    )
  }

  return buffer
}

const tryEncodeAnimatedThumbnail = async (
  command: string,
  inputPath: string,
  outputPath: string,
  scaleFilter: string
) => {
  await runCommand(command, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-vf',
    scaleFilter,
    '-c:v',
    'libaom-av1',
    '-crf',
    '34',
    '-cpu-used',
    '6',
    '-an',
    outputPath
  ])

  return readGeneratedThumbnail(outputPath)
}

const tryEncodeStillThumbnail = async (
  command: string,
  inputPath: string,
  outputPath: string,
  scaleFilter: string
) => {
  await runCommand(command, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    scaleFilter,
    '-c:v',
    'libaom-av1',
    '-crf',
    '34',
    '-cpu-used',
    '6',
    outputPath
  ])

  return readGeneratedThumbnail(outputPath)
}

export const createAnimatedAvifThumbnail = async (
  image: Buffer
): Promise<Buffer | null> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'otoame-avif-thumb-'))
  const inputPath = path.join(directory, 'input.avif')
  const animatedOutputPath = path.join(directory, 'thumbnail-animated.avif')
  const stillOutputPath = path.join(directory, 'thumbnail-still.avif')
  const scaleFilter = 'scale=' + GALLERY_AVIF_THUMBNAIL_MAX_WIDTH + ':' + GALLERY_AVIF_THUMBNAIL_MAX_HEIGHT + ':force_original_aspect_ratio=decrease'

  try {
    await writeFile(inputPath, image)
    const commands = await getGalleryFfmpegCommands()
    const failures: string[] = []

    for (const command of commands) {
      try {
        const animatedThumbnail = await tryEncodeAnimatedThumbnail(
          command,
          inputPath,
          animatedOutputPath,
          scaleFilter
        )
        if (animatedThumbnail) {
          return animatedThumbnail
        }
      } catch (error) {
        failures.push(
          'animated:' + command + ': ' + (error instanceof Error ? error.message : String(error))
        )
      }
    }

    for (const command of commands) {
      try {
        const stillThumbnail = await tryEncodeStillThumbnail(
          command,
          inputPath,
          stillOutputPath,
          scaleFilter
        )
        if (stillThumbnail) {
          return stillThumbnail
        }
      } catch (error) {
        failures.push(
          'still:' + command + ': ' + (error instanceof Error ? error.message : String(error))
        )
      }
    }

    console.warn(
      'Animated AVIF thumbnail generation failed for all commands: ' + failures.join(' | ')
    )
    return null
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}
