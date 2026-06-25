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

export type AvifFrameProbe = {
  error?: string
  frameCount?: number
  streamSpecifier: string | null
}

const getOptionalFfmpegPaths = () => {
  const paths: string[] = []
  const configuredPath = process.env.KUN_GALLERY_FFMPEG_PATH
  if (configuredPath) {
    paths.push(configuredPath)
  }

  paths.push(
    path.join(process.cwd(), '.ffmpeg', 'ffmpeg'),
    path.join(process.cwd(), 'node_modules', '.ffmpeg', 'ffmpeg')
  )

  return paths
}

const getFfmpegStaticPath = () => {
  try {
    const ffmpegStatic = require('ffmpeg-static') as unknown
    return typeof ffmpegStatic === 'string' ? ffmpegStatic : null
  } catch {
    return null
  }
}

export const getGalleryFfmpegCommands = async () => {
  const commands = [
    ...getOptionalFfmpegPaths().filter((ffmpegPath) => existsSync(ffmpegPath)),
    getFfmpegStaticPath(),
    SYSTEM_FFMPEG_COMMAND
  ].filter((command): command is string => Boolean(command))

  return Array.from(new Set(commands))
}

const runCommand = (
  command: string,
  args: string[],
  timeoutMs = GALLERY_AVIF_THUMBNAIL_TIMEOUT_MS,
  allowedExitCodes = [0]
) =>
  new Promise<string>((resolve, reject) => {
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
      if (code !== null && allowedExitCodes.includes(code)) {
        resolve(stderr)
        return
      }

      reject(new Error(command + ' exited with code ' + code + ': ' + stderr))
    })
  })

const countShowInfoFrames = (stderr: string) => {
  const matches = stderr.match(/(?:^|\s)n:\s*\d+/gm)
  return matches?.length ?? 0
}

const parseVideoStreamSpecifiers = (stderr: string) => {
  const streams = stderr
    .split(/\r?\n/)
    .map((line) => line.match(/Stream #(\d+:\d+)(?:\[[^\]]+\])?(?:\([^)]+\))?: Video:/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => match[1])

  return Array.from(new Set(streams))
}

const getAvifVideoStreamSpecifiers = async (
  command: string,
  inputPath: string
) => {
  const stderr = await runCommand(
    command,
    ['-hide_banner', '-i', inputPath],
    GALLERY_AVIF_THUMBNAIL_TIMEOUT_MS,
    [0, 1]
  )

  return parseVideoStreamSpecifiers(stderr)
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export const countAvifFrames = async (
  command: string,
  inputPath: string,
  streamSpecifier?: string | null
) => {
  const args = [
    '-hide_banner',
    '-loglevel',
    'info',
    '-i',
    inputPath
  ]

  if (streamSpecifier) {
    args.push('-map', streamSpecifier)
  }

  args.push(
    '-vf',
    'showinfo',
    '-f',
    'null',
    '-'
  )

  const stderr = await runCommand(command, args)

  return countShowInfoFrames(stderr)
}

export const probeAvifFrameCounts = async (
  command: string,
  inputPath: string
) => {
  const probes: AvifFrameProbe[] = []

  try {
    probes.push({
      frameCount: await countAvifFrames(command, inputPath),
      streamSpecifier: null
    })
  } catch (error) {
    probes.push({
      error: getErrorMessage(error),
      streamSpecifier: null
    })
    return probes
  }

  if (probes.some((probe) => (probe.frameCount ?? 0) > 1)) {
    return probes
  }

  const streamSpecifiers = await getAvifVideoStreamSpecifiers(command, inputPath)
  for (const streamSpecifier of streamSpecifiers) {
    try {
      probes.push({
        frameCount: await countAvifFrames(command, inputPath, streamSpecifier),
        streamSpecifier
      })
    } catch (error) {
      probes.push({
        error: getErrorMessage(error),
        streamSpecifier
      })
    }
  }

  return probes
}

const findAnimatedAvifStream = async (command: string, inputPath: string) => {
  const probes = await probeAvifFrameCounts(command, inputPath)

  return (
    probes.find((probe) => probe.frameCount !== undefined && probe.frameCount > 1) ??
    null
  )
}

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
  const animatedInputStream = await findAnimatedAvifStream(command, inputPath)
  if (!animatedInputStream) {
    throw new Error('input AVIF has no animated video stream')
  }

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath
  ]

  if (animatedInputStream.streamSpecifier) {
    args.push('-map', animatedInputStream.streamSpecifier)
  }

  args.push(
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
  )

  await runCommand(command, args)

  const thumbnail = await readGeneratedThumbnail(outputPath)
  const animatedOutputStream = await findAnimatedAvifStream(command, outputPath)
  if (!animatedOutputStream) {
    throw new Error('animated thumbnail has no animated video stream')
  }

  return thumbnail
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
