import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createAnimatedAvifThumbnail } from '../app/api/edit/galleryAnimatedAvifThumbnail'

const [inputPath, outputPath = '/tmp/otoame-gallery-avif-thumbnail.avif'] =
  process.argv.slice(2)

if (!inputPath) {
  console.error(
    'Usage: pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts <animated.avif> [output.avif]'
  )
  process.exit(1)
}

const input = await readFile(inputPath)
const thumbnail = await createAnimatedAvifThumbnail(input)

if (!thumbnail) {
  console.error(
    'Failed to generate gallery AVIF thumbnail. Check that ffmpeg and libaom-av1 are available.'
  )
  process.exit(1)
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, thumbnail)
console.log(`Wrote ${thumbnail.byteLength} bytes to ${outputPath}`)
