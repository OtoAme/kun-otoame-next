import 'dotenv/config'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import sharp from 'sharp'
import { prisma } from '~/prisma/index'
import { uploadBufferToS3 } from '~/lib/s3'
import { getGalleryFfmpegCommands } from '../app/api/edit/galleryAnimatedAvifThumbnail'

const MAX_STICKER_SIDE = 512
const MAX_STATIC_BYTES = 512 * 1024
const MAX_VIDEO_DURATION_MS = 3_000
const MAX_VIDEO_FPS = 30
const MAX_VIDEO_BYTES = 256 * 1024
const STICKER_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const manifestIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'must contain only letters, numbers, _ or -')

const manifestStickerSchema = z.object({
  id: manifestIdentifierSchema,
  file: z.string().trim().min(1).max(500),
  thumbnail: z.string().trim().min(1).max(500).optional(),
  alt: z.string().trim().max(255).default(''),
  sortOrder: z.number().int().min(0).max(999999).default(0)
})

const manifestSchema = z.object({
  pack: z.object({
    slug: manifestIdentifierSchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(''),
    cover: z.string().trim().min(1).max(500).optional(),
    price: z.number().int().min(0).max(999999).default(0),
    status: z.number().int().default(1),
    isBuiltin: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(999999).default(0)
  }),
  stickers: z.array(manifestStickerSchema).min(1)
})

type Manifest = z.infer<typeof manifestSchema>
type MediaKind = 'image' | 'video'

type ParsedMedia = {
  kind: MediaKind
  mime: string
  width: number
  height: number
  size: number
  durationMs: number | null
  frameRate: number | null
  asset: Buffer
  thumbnail: Buffer | null
  extension: 'webp' | 'webm'
}

const getArgValue = (args: string[], name: string) => {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

const getOptions = () => {
  const args = process.argv.slice(2)
  const manifest = getArgValue(args, '--manifest')
  if (!manifest) {
    throw new Error(
      'Usage: pnpm stickers:sync -- --manifest=/path/stickers.json [--root=/path/assets] [--apply]'
    )
  }

  return {
    manifestPath: path.resolve(manifest),
    rootPath: path.resolve(
      getArgValue(args, '--root') ?? path.dirname(manifest)
    ),
    apply: args.includes('--apply')
  }
}

const getSafeAssetPath = (rootPath: string, relativePath: string) => {
  const root = path.resolve(rootPath)
  const target = path.resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Asset path escapes root directory: ${relativePath}`)
  }
  return target
}

const runCommand = (
  command: string,
  args: string[],
  input?: Buffer
): Promise<{ stdout: Buffer; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    let stderr = ''

    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolve({ stdout: Buffer.concat(stdout), stderr })
        return
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr}`))
    })

    if (input) {
      child.stdin?.end(input)
    }
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

const probeWebm = async (filePath: string, asset: Buffer) => {
  const commands = await getGalleryFfmpegCommands()
  let lastError = 'No FFmpeg command is available'

  for (const command of commands) {
    try {
      const probe = await runCommand(command, ['-hide_banner', '-i', filePath])
      const videoLine = probe.stderr.match(/Video:\s*[^\n]*/i)?.[0] ?? ''
      const dimensions = parseVideoDimensions(probe.stderr)
      const durationMs = parseDurationMs(probe.stderr)
      const frameRate = parseVideoFrameRate(probe.stderr)

      if (!/vp9/i.test(videoLine)) {
        throw new Error('dynamic sticker must use VP9')
      }
      if (/Stream #[^\n]*Audio:/i.test(probe.stderr)) {
        throw new Error('dynamic sticker must not contain audio')
      }
      if (!dimensions) {
        throw new Error('dynamic sticker dimensions could not be detected')
      }
      if (!durationMs || durationMs > MAX_VIDEO_DURATION_MS) {
        throw new Error('dynamic sticker duration must be at most 3 seconds')
      }
      if (!frameRate || frameRate > MAX_VIDEO_FPS) {
        throw new Error('dynamic sticker frame rate must be at most 30 FPS')
      }
      if (
        dimensions.width > MAX_STICKER_SIDE ||
        dimensions.height > MAX_STICKER_SIDE
      ) {
        throw new Error('sticker dimensions must not exceed 512 pixels')
      }
      if (asset.byteLength > MAX_VIDEO_BYTES) {
        throw new Error('dynamic sticker must not exceed 256 KB')
      }

      const posterResult = await runCommand(command, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-f',
        'image2pipe',
        '-vcodec',
        'png',
        'pipe:1'
      ])
      const thumbnail = await sharp(posterResult.stdout)
        .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()

      return {
        kind: 'video' as const,
        mime: 'video/webm',
        width: dimensions.width,
        height: dimensions.height,
        size: asset.byteLength,
        durationMs,
        frameRate,
        asset,
        thumbnail,
        extension: 'webm' as const
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  throw new Error(`Failed to validate WebM ${filePath}: ${lastError}`)
}

const parseMedia = async (filePath: string): Promise<ParsedMedia> => {
  const asset = await readFile(filePath)
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.webm') {
    if (asset.byteLength > MAX_VIDEO_BYTES) {
      throw new Error(`${filePath}: dynamic sticker must not exceed 256 KB`)
    }
    return probeWebm(filePath, asset)
  }

  if (extension !== '.webp') {
    throw new Error(`${filePath}: sticker assets must be .webp or .webm`)
  }

  const metadata = await sharp(asset).metadata()
  if (metadata.format !== 'webp') {
    throw new Error(`${filePath}: static sticker must be a valid WebP`)
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_STICKER_SIDE ||
    metadata.height > MAX_STICKER_SIDE
  ) {
    throw new Error(
      `${filePath}: sticker dimensions must not exceed 512 pixels`
    )
  }
  if (asset.byteLength > MAX_STATIC_BYTES) {
    throw new Error(`${filePath}: static sticker must not exceed 512 KB`)
  }
  if (metadata.pages && metadata.pages > 1) {
    throw new Error(
      `${filePath}: animated WebP is not accepted as a static sticker`
    )
  }

  return {
    kind: 'image',
    mime: 'image/webp',
    width: metadata.width,
    height: metadata.height,
    size: asset.byteLength,
    durationMs: null,
    frameRate: null,
    asset,
    thumbnail: asset,
    extension: 'webp'
  }
}

const getPublicUrl = (key: string) => {
  const baseUrl = process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL is required')
  }
  return `${baseUrl.replace(/\/+$/, '')}/${key}`
}

const readManifest = async (manifestPath: string) => {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  const manifest = manifestSchema.parse(parsed)
  const ids = manifest.stickers.map((sticker) => sticker.id)
  if (new Set(ids).size !== ids.length) {
    throw new Error('Sticker IDs must be unique within a manifest')
  }
  return manifest
}

const syncManifest = async (
  manifest: Manifest,
  rootPath: string,
  apply: boolean
) => {
  const prepared = [] as Array<{
    item: Manifest['stickers'][number]
    media: ParsedMedia
    assetKey: string
    thumbnailKey: string | null
  }>

  for (const item of manifest.stickers) {
    const filePath = getSafeAssetPath(rootPath, item.file)
    await stat(filePath)
    let media = await parseMedia(filePath)
    if (item.thumbnail) {
      if (media.kind !== 'video') {
        throw new Error(
          `${filePath}: thumbnail is only supported for dynamic WebM stickers`
        )
      }
      const thumbnailPath = getSafeAssetPath(rootPath, item.thumbnail)
      const thumbnailMedia = await parseMedia(thumbnailPath)
      if (thumbnailMedia.kind !== 'image') {
        throw new Error(
          `${thumbnailPath}: sticker thumbnail must be a static WebP`
        )
      }
      media = { ...media, thumbnail: thumbnailMedia.asset }
    }
    const assetKey = `sticker/${manifest.pack.slug}/${item.id}/asset.${media.extension}`
    const thumbnailKey =
      media.kind === 'video'
        ? `sticker/${manifest.pack.slug}/${item.id}/poster.webp`
        : null
    prepared.push({ item, media, assetKey, thumbnailKey })
  }

  if (apply) {
    const existingStickers = await prisma.sticker.findMany({
      where: { id: { in: prepared.map(({ item }) => item.id) } },
      select: { id: true, pack: { select: { slug: true } } }
    })
    const conflictingSticker = existingStickers.find(
      (sticker) => sticker.pack.slug !== manifest.pack.slug
    )

    if (conflictingSticker) {
      throw new Error(
        `Sticker ID already belongs to another pack: ${conflictingSticker.id}`
      )
    }
  }

  const coverKey = manifest.pack.cover
    ? `sticker/${manifest.pack.slug}/cover.webp`
    : null
  if (manifest.pack.cover) {
    const coverPath = getSafeAssetPath(rootPath, manifest.pack.cover)
    await stat(coverPath)
    const cover = await parseMedia(coverPath)
    if (cover.kind !== 'image') {
      throw new Error('sticker pack cover must be a static WebP')
    }
    if (apply) {
      await uploadBufferToS3(
        coverKey!,
        cover.asset,
        'image/webp',
        STICKER_CACHE_CONTROL
      )
    }
  }

  if (!apply) {
    console.info(
      JSON.stringify(
        {
          mode: 'dry-run',
          pack: manifest.pack,
          stickers: prepared.map(({ item, media, assetKey, thumbnailKey }) => ({
            id: item.id,
            file: item.file,
            mediaType: media.kind,
            mime: media.mime,
            width: media.width,
            height: media.height,
            size: media.size,
            assetKey,
            thumbnailKey
          }))
        },
        null,
        2
      )
    )
    return
  }

  const pack = await prisma.sticker_pack.upsert({
    where: { slug: manifest.pack.slug },
    create: {
      slug: manifest.pack.slug,
      name: manifest.pack.name,
      description: manifest.pack.description,
      cover_url: coverKey ? getPublicUrl(coverKey) : null,
      price: manifest.pack.price,
      status: manifest.pack.status,
      is_builtin: manifest.pack.isBuiltin,
      sort_order: manifest.pack.sortOrder
    },
    update: {
      name: manifest.pack.name,
      description: manifest.pack.description,
      cover_url: coverKey ? getPublicUrl(coverKey) : null,
      price: manifest.pack.price,
      status: manifest.pack.status,
      is_builtin: manifest.pack.isBuiltin,
      sort_order: manifest.pack.sortOrder
    }
  })

  for (const { item, media, assetKey, thumbnailKey } of prepared) {
    await uploadBufferToS3(
      assetKey,
      media.asset,
      media.mime,
      STICKER_CACHE_CONTROL
    )
    if (thumbnailKey && media.thumbnail) {
      await uploadBufferToS3(
        thumbnailKey,
        media.thumbnail,
        'image/webp',
        STICKER_CACHE_CONTROL
      )
    }

    await prisma.sticker.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        pack_id: pack.id,
        alt: item.alt,
        asset_url: getPublicUrl(assetKey),
        thumbnail_url: thumbnailKey
          ? getPublicUrl(thumbnailKey)
          : getPublicUrl(assetKey),
        storage_key: assetKey,
        thumbnail_storage_key: thumbnailKey,
        mime: media.mime,
        media_type: media.kind,
        width: media.width,
        height: media.height,
        size: media.size,
        duration_ms: media.durationMs,
        frame_rate: media.frameRate,
        sort_order: item.sortOrder
      },
      update: {
        pack_id: pack.id,
        alt: item.alt,
        asset_url: getPublicUrl(assetKey),
        thumbnail_url: thumbnailKey
          ? getPublicUrl(thumbnailKey)
          : getPublicUrl(assetKey),
        storage_key: assetKey,
        thumbnail_storage_key: thumbnailKey,
        mime: media.mime,
        media_type: media.kind,
        width: media.width,
        height: media.height,
        size: media.size,
        duration_ms: media.durationMs,
        frame_rate: media.frameRate,
        sort_order: item.sortOrder
      }
    })
  }

  console.info(`Synchronized sticker pack ${manifest.pack.slug}`)
}

const main = async () => {
  const options = getOptions()
  const manifest = await readManifest(options.manifestPath)
  await syncManifest(manifest, options.rootPath, options.apply)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
