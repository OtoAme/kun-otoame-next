import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  countAvifFrames,
  createAnimatedAvifThumbnail,
  getGalleryFfmpegCommands
} from '../app/api/edit/galleryAnimatedAvifThumbnail'

const [inputPath, outputPath = '/tmp/otoame-gallery-avif-thumbnail.avif'] =
  process.argv.slice(2)

if (!inputPath) {
  console.error(
    'Usage: pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts <animated.avif> [output.avif]'
  )
  process.exit(1)
}

const input = await readFile(inputPath)
const commands = await getGalleryFfmpegCommands()
const inspectCommand = commands[0]

if (!inspectCommand) {
  console.error('No ffmpeg command is available.')
  process.exit(1)
}

const inputFrameCount = await countAvifFrames(inspectCommand, inputPath)
if (inputFrameCount <= 1) {
  console.error(
    `Input AVIF is not decoded as animated by ${inspectCommand}: ${inputFrameCount} frame(s).`
  )
  process.exit(1)
}

const thumbnail = await createAnimatedAvifThumbnail(input)

if (!thumbnail) {
  console.error(
    'Failed to generate gallery AVIF thumbnail. Check that ffmpeg and libaom-av1 are available.'
  )
  process.exit(1)
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, thumbnail)

const outputFrameCount = await countAvifFrames(inspectCommand, outputPath)
if (outputFrameCount <= 1) {
  console.error(
    `Generated thumbnail is not animated by ${inspectCommand}: ${outputFrameCount} frame(s), ${thumbnail.byteLength} bytes at ${outputPath}.`
  )
  process.exit(1)
}

console.log(
  `Wrote animated AVIF thumbnail: ${thumbnail.byteLength} bytes, ${outputFrameCount} frames to ${outputPath}`
)
