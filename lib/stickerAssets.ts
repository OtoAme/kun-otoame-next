import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import * as yauzl from 'yauzl'
import sharp from 'sharp'
import { getGalleryFfmpegCommands } from '~/app/api/edit/galleryAnimatedAvifThumbnail'

export const STICKER_MAX_SIDE = 512
export const STICKER_STATIC_MAX_BYTES = 512 * 1024
export const STICKER_WEBM_MAX_BYTES = 300 * 1024
export const STICKER_MAX_DURATION_MS = 3_000
export const STICKER_MAX_ESTIMATED_FRAMES = 100
export const STICKER_MAX_IMPORT_ITEMS = 200
export const STICKER_MAX_IMPORT_BYTES = 64 * 1024 * 1024
export const STICKER_MAX_ZIP_BYTES = 32 * 1024 * 1024
export const STICKER_MAX_ZIP_ENTRIES = 200
export const STICKER_MAX_ZIP_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
export const STICKER_CACHE_CONTROL = 'public, max-age=31536000, immutable'

const FFMPEG_TIMEOUT_MS = 15_000
const ZIP_COMPRESSION_RATIO_LIMIT = 200
const WEBP_SIGNATURE = Buffer.from('RIFF')
const WEBM_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])

export type StickerMediaType = 'image' | 'video'

export type StickerSourceFile = {
  name: string
  buffer: Buffer
}

export type ParsedStickerAsset = {
  mediaType: StickerMediaType
  mime: 'image/webp' | 'video/webm'
  width: number
  height: number
  size: number
  durationMs: number | null
  frameRate: number | null
  asset: Buffer
  poster: Buffer | null
  extension: 'webp' | 'webm'
  contentHash: string
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export const getStickerFfmpegFailureReason = (
  previousReason: string | null,
  error: unknown
) => {
  const isMissingCommand =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'

  return isMissingCommand && previousReason
    ? previousReason
    : getErrorMessage(error)
}

const runCommand = (
  command: string,
  args: string[],
  allowedExitCodes = [0, 1]
): Promise<{ stdout: Buffer; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} timed out`))
    }, FFMPEG_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
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
        resolve({ stdout: Buffer.concat(stdout), stderr })
        return
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr}`))
    })
  })

const parseDurationMs = (probe: string) => {
  const match = probe.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
  if (!match) return null
  return Math.round(
    (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000
  )
}

const parseVideoDimensions = (probe: string) => {
  const match = probe.match(/Video:\s*[^\n]*?(\d{2,5})x(\d{2,5})/i)
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}

const parseVideoFrameRate = (probe: string) => {
  const match = probe.match(/(\d+(?:\.\d+)?)\s+(?:fps|tbr)\b/i)
  return match ? Number(match[1]) : null
}

export const getStickerEstimatedFrameCount = (
  durationMs: number | null,
  frameRate: number | null
) => {
  if (
    !durationMs ||
    !frameRate ||
    !Number.isFinite(durationMs) ||
    !Number.isFinite(frameRate)
  ) {
    return null
  }

  return Math.ceil((durationMs * frameRate) / 1000)
}

export const hasStickerWebmAlpha = (probe: string) =>
  /alpha_mode\s*:\s*1\b/i.test(probe) ||
  /\b(?:yuva|rgba|bgra|argb|abgr)[a-z0-9]*\b/i.test(probe)

export const getStickerWebmInputArgs = (inputPath: string) => [
  '-c:v',
  'libvpx-vp9',
  '-i',
  inputPath
]

const isWebpBuffer = (buffer: Buffer) =>
  buffer.length >= 12 &&
  buffer.subarray(0, 4).equals(WEBP_SIGNATURE) &&
  buffer.subarray(8, 12).toString('ascii') === 'WEBP'

const isWebmBuffer = (buffer: Buffer) =>
  buffer.length >= WEBM_SIGNATURE.length &&
  buffer.subarray(0, 4).equals(WEBM_SIGNATURE)

const parseStaticSticker = async (
  fileName: string,
  asset: Buffer,
  contentHash: string
): Promise<ParsedStickerAsset> => {
  if (!isWebpBuffer(asset)) {
    throw new Error(`${fileName}: 文件真实类型不是 WebP`)
  }

  const metadata = await sharp(asset, { pages: -1 }).metadata()
  if (metadata.format !== 'webp') {
    throw new Error(`${fileName}: 文件真实类型不是 WebP`)
  }
  if (!metadata.width || !metadata.height) {
    throw new Error(`${fileName}: 无法读取 Sticker 尺寸`)
  }
  if (metadata.width > STICKER_MAX_SIDE || metadata.height > STICKER_MAX_SIDE) {
    throw new Error(`${fileName}: Sticker 尺寸不能超过 ${STICKER_MAX_SIDE}px`)
  }
  if (asset.byteLength > STICKER_STATIC_MAX_BYTES) {
    throw new Error(
      `${fileName}: 静态 Sticker 不能超过 ${STICKER_STATIC_MAX_BYTES / 1024} KB`
    )
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new Error(`${fileName}: 不支持动态 WebP，请使用 VP9 WebM`)
  }

  return {
    mediaType: 'image',
    mime: 'image/webp',
    width: metadata.width,
    height: metadata.height,
    size: asset.byteLength,
    durationMs: null,
    frameRate: null,
    asset,
    poster: null,
    extension: 'webp',
    contentHash
  }
}

const parseDynamicSticker = async (
  fileName: string,
  asset: Buffer,
  contentHash: string
): Promise<ParsedStickerAsset> => {
  if (!isWebmBuffer(asset)) {
    throw new Error(`${fileName}: 文件真实类型不是 WebM`)
  }
  if (asset.byteLength > STICKER_WEBM_MAX_BYTES) {
    throw new Error(
      `${fileName}: 动态 Sticker 不能超过 ${STICKER_WEBM_MAX_BYTES / 1024} KB`
    )
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'otoame-sticker-'))
  const inputPath = path.join(directory, 'input.webm')

  try {
    await writeFile(inputPath, asset)
    const commands = await getGalleryFfmpegCommands()
    let lastError: string | null = null

    for (const command of commands) {
      try {
        const probe = await runCommand(command, [
          '-hide_banner',
          '-i',
          inputPath
        ])
        const videoLines =
          probe.stderr.match(/Stream #[^\n]*Video:[^\n]*/gi) ?? []
        const videoLine = videoLines[0] ?? ''
        const dimensions = parseVideoDimensions(probe.stderr)
        const durationMs = parseDurationMs(probe.stderr)
        const frameRate = parseVideoFrameRate(probe.stderr)

        if (!/vp9/i.test(videoLine)) {
          throw new Error('动态 Sticker 必须使用 VP9 编码')
        }
        if (!hasStickerWebmAlpha(probe.stderr)) {
          throw new Error('动态 Sticker 必须包含透明通道')
        }
        if (/Stream #[^\n]*Audio:/i.test(probe.stderr)) {
          throw new Error('动态 Sticker 不能包含音轨')
        }
        if (!dimensions) {
          throw new Error('无法读取动态 Sticker 尺寸')
        }
        if (!durationMs || durationMs > STICKER_MAX_DURATION_MS) {
          throw new Error(
            `动态 Sticker 时长不能超过 ${STICKER_MAX_DURATION_MS / 1000} 秒`
          )
        }
        const estimatedFrameCount = getStickerEstimatedFrameCount(
          durationMs,
          frameRate
        )
        if (!estimatedFrameCount) {
          throw new Error('无法读取动态 Sticker 帧率')
        }
        if (estimatedFrameCount > STICKER_MAX_ESTIMATED_FRAMES) {
          throw new Error(
            `动态 Sticker 估算总帧数不能超过 ${STICKER_MAX_ESTIMATED_FRAMES} 帧`
          )
        }
        if (
          dimensions.width > STICKER_MAX_SIDE ||
          dimensions.height > STICKER_MAX_SIDE
        ) {
          throw new Error(`Sticker 尺寸不能超过 ${STICKER_MAX_SIDE}px`)
        }

        const posterResult = await runCommand(
          command,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            ...getStickerWebmInputArgs(inputPath),
            '-frames:v',
            '1',
            '-f',
            'image2pipe',
            '-vcodec',
            'png',
            'pipe:1'
          ],
          [0]
        )
        if (posterResult.stdout.byteLength === 0) {
          throw new Error('无法生成动态 Sticker poster')
        }

        const poster = await sharp(posterResult.stdout)
          .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer()

        if (poster.byteLength > STICKER_STATIC_MAX_BYTES) {
          throw new Error('动态 Sticker poster 不能超过 512 KB')
        }

        return {
          mediaType: 'video',
          mime: 'video/webm',
          width: dimensions.width,
          height: dimensions.height,
          size: asset.byteLength,
          durationMs,
          frameRate,
          asset,
          poster,
          extension: 'webm',
          contentHash
        }
      } catch (error) {
        lastError = getStickerFfmpegFailureReason(lastError, error)
      }
    }

    throw new Error(
      `${fileName}: 动态 Sticker 校验失败：${lastError ?? '未找到可用的 FFmpeg'}`
    )
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

export const parseStickerAsset = async (
  source: StickerSourceFile
): Promise<ParsedStickerAsset> => {
  const extension = path.extname(source.name).toLowerCase()
  const contentHash = createHash('sha256').update(source.buffer).digest('hex')

  if (extension === '.webp') {
    return parseStaticSticker(source.name, source.buffer, contentHash)
  }
  if (extension === '.webm') {
    return parseDynamicSticker(source.name, source.buffer, contentHash)
  }

  throw new Error(`${source.name}: 仅支持 WebP 或无音频 VP9 WebM`)
}

const isZipSignature = (buffer: Buffer) =>
  buffer.length >= 4 &&
  (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08])))

const isSymlinkEntry = (entry: yauzl.Entry) => {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  return (unixMode & 0xf000) === 0xa000
}

const normalizeZipEntryName = (name: string) => {
  const normalizedSeparators = name.replaceAll('\\', '/')
  if (
    !normalizedSeparators ||
    normalizedSeparators.includes('\0') ||
    normalizedSeparators.startsWith('//') ||
    /^[a-z]:\//i.test(normalizedSeparators)
  ) {
    throw new Error(`ZIP 条目路径不安全：${name}`)
  }

  const relativeName = normalizedSeparators.startsWith('/')
    ? normalizedSeparators.slice(1)
    : normalizedSeparators
  if (!relativeName) {
    throw new Error(`ZIP 条目路径不安全：${name}`)
  }

  const parts = relativeName.split('/')
  if (parts.some((part) => part === '..')) {
    throw new Error(`ZIP 条目路径不能包含 ..：${name}`)
  }

  const normalized = path.posix.normalize(relativeName)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`ZIP 条目路径不安全：${name}`)
  }

  return normalized
}

const readStreamBuffer = async (stream: Readable, maxBytes: number) => {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > maxBytes) {
      stream.destroy()
      throw new Error('ZIP 条目解压后超过安全大小限制')
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks)
}

export const extractStickerZip = async (
  archive: StickerSourceFile
): Promise<StickerSourceFile[]> => {
  if (archive.buffer.byteLength > STICKER_MAX_ZIP_BYTES) {
    throw new Error(
      `ZIP 文件不能超过 ${STICKER_MAX_ZIP_BYTES / 1024 / 1024} MB`
    )
  }
  if (!isZipSignature(archive.buffer)) {
    throw new Error(`${archive.name}: 文件真实类型不是 ZIP`)
  }

  const zipfile = await yauzl.fromBufferPromise(archive.buffer, {
    lazyEntries: true,
    // Decode manually so a harmless leading archive-root slash can be
    // normalized before applying the local traversal checks below.
    decodeStrings: false,
    validateEntrySizes: true,
    strictFileNames: false
  })
  const files: StickerSourceFile[] = []
  const names = new Set<string>()
  let entryCount = 0
  let totalUncompressed = 0

  try {
    for await (const entry of zipfile.eachEntry()) {
      entryCount += 1
      if (entryCount > STICKER_MAX_ZIP_ENTRIES) {
        throw new Error(`ZIP 条目数量不能超过 ${STICKER_MAX_ZIP_ENTRIES} 个`)
      }

      const decodedName = yauzl.getFileNameLowLevel(
        entry.generalPurposeBitFlag,
        entry.fileNameRaw,
        entry.extraFields,
        false
      )
      const name = normalizeZipEntryName(decodedName)
      const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
      if (isSymlinkEntry(entry)) {
        throw new Error(`ZIP 不允许包含符号链接：${name}`)
      }
      const isDirectory = name.endsWith('/') || (unixMode & 0xf000) === 0x4000
      if (isDirectory) {
        continue
      }
      if (entry.isEncrypted()) {
        throw new Error(`ZIP 不支持加密条目：${name}`)
      }

      const extension = path.extname(name).toLowerCase()
      if (extension !== '.webp' && extension !== '.webm') {
        throw new Error(`ZIP 条目 ${name} 不是支持的 WebP/WebM 文件`)
      }
      const maxEntryBytes =
        extension === '.webm'
          ? STICKER_WEBM_MAX_BYTES
          : STICKER_STATIC_MAX_BYTES
      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize > maxEntryBytes
      ) {
        throw new Error(`ZIP 条目 ${name} 解压后超过文件大小限制`)
      }
      totalUncompressed += entry.uncompressedSize
      if (totalUncompressed > STICKER_MAX_ZIP_UNCOMPRESSED_BYTES) {
        throw new Error(
          `ZIP 解压后总大小不能超过 ${STICKER_MAX_ZIP_UNCOMPRESSED_BYTES / 1024 / 1024} MB`
        )
      }
      if (
        entry.compressedSize === 0 ||
        entry.uncompressedSize / entry.compressedSize >
          ZIP_COMPRESSION_RATIO_LIMIT
      ) {
        throw new Error(`ZIP 条目 ${name} 的压缩比例异常，疑似 ZIP Bomb`)
      }
      if (names.has(name.toLowerCase())) {
        throw new Error(`ZIP 包中存在重复文件：${name}`)
      }
      names.add(name.toLowerCase())

      const stream = await zipfile.openReadStreamPromise(entry)
      const buffer = await readStreamBuffer(stream, maxEntryBytes)
      if (buffer.byteLength !== entry.uncompressedSize) {
        throw new Error(`ZIP 条目 ${name} 解压大小校验失败`)
      }
      files.push({ name, buffer })
    }
  } finally {
    zipfile.close()
  }

  if (!files.length) {
    throw new Error('ZIP 中没有可导入的 WebP/WebM Sticker')
  }

  return files
}

export const buildStickerId = (
  packSlug: string,
  fileName: string,
  contentHash: string
) => {
  const baseName = path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  const safeBaseName = baseName || 'sticker'
  const idPrefix = `${packSlug}_${safeBaseName}`
  return `${idPrefix.slice(0, 81)}_${contentHash.slice(0, 18)}`.slice(0, 100)
}

export const getStickerAssetKey = (
  packSlug: string,
  stickerId: string,
  extension: 'webp' | 'webm'
) => `sticker/${packSlug}/${stickerId}/asset.${extension}`

export const getStickerPosterKey = (
  packSlug: string,
  stickerId: string,
  poster: Buffer
) => {
  const posterHash = createHash('sha256').update(poster).digest('hex')
  return `sticker/${packSlug}/${stickerId}/poster-${posterHash.slice(0, 16)}.webp`
}
