import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  countAvifFrames,
  createAnimatedAvifThumbnail,
  getGalleryFfmpegCommands
} from '../app/api/edit/galleryAnimatedAvifThumbnail'

type FrameProbe = {
  command: string
  error?: string
  frameCount?: number
}

const [inputPath, outputPath = '/tmp/otoame-gallery-avif-thumbnail.avif'] =
  process.argv.slice(2)

if (!inputPath) {
  console.error(
    'Usage: pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts <animated.avif> [output.avif]'
  )
  process.exit(1)
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const probeFrameCounts = async (commands: string[], filePath: string) => {
  const probes: FrameProbe[] = []

  for (const command of commands) {
    try {
      probes.push({
        command,
        frameCount: await countAvifFrames(command, filePath)
      })
    } catch (error) {
      probes.push({
        command,
        error: getErrorMessage(error)
      })
    }
  }

  return probes
}

const printFrameCounts = (label: string, probes: FrameProbe[]) => {
  console.info(`${label} frame counts:`)
  for (const probe of probes) {
    console.info(
      `- ${probe.command}: ${
        probe.error ? `error: ${probe.error}` : `${probe.frameCount} frame(s)`
      }`
    )
  }
}

const hasAnimatedFrames = (probe: FrameProbe) =>
  probe.frameCount !== undefined && probe.frameCount > 1

const input = await readFile(inputPath)
const commands = await getGalleryFfmpegCommands()

if (commands.length === 0) {
  console.error('No ffmpeg command is available.')
  process.exit(1)
}

const inputProbes = await probeFrameCounts(commands, inputPath)
printFrameCounts('Input AVIF', inputProbes)

if (!inputProbes.some(hasAnimatedFrames)) {
  console.error('Input AVIF is not decoded as animated by any ffmpeg command.')
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

const outputProbes = await probeFrameCounts(commands, outputPath)
printFrameCounts('Output thumbnail', outputProbes)

const animatedOutputProbe = outputProbes.find(hasAnimatedFrames)
if (!animatedOutputProbe) {
  console.error(
    `Generated thumbnail is not animated by any ffmpeg command: ${thumbnail.byteLength} bytes at ${outputPath}.`
  )
  process.exit(1)
}

console.log(
  `Wrote animated AVIF thumbnail: ${thumbnail.byteLength} bytes, ${animatedOutputProbe.frameCount} frames to ${outputPath}`
)
