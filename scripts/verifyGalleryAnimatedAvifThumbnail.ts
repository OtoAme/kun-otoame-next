import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  AvifFrameProbe,
  createAnimatedAvifThumbnail,
  getGalleryFfmpegCommands,
  probeAvifFrameCounts
} from '../app/api/edit/galleryAnimatedAvifThumbnail'

type CommandProbe = {
  command: string
  probes: AvifFrameProbe[]
}

const [inputPath, outputPath = '/tmp/otoame-gallery-avif-thumbnail.avif'] =
  process.argv.slice(2)

if (!inputPath) {
  console.error(
    'Usage: pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts <animated.avif> [output.avif]'
  )
  process.exit(1)
}

const probeFrameCounts = async (commands: string[], filePath: string) => {
  const probes: CommandProbe[] = []

  for (const command of commands) {
    probes.push({
      command,
      probes: await probeAvifFrameCounts(command, filePath)
    })
  }

  return probes
}

const formatStream = (streamSpecifier: string | null) =>
  streamSpecifier ?? 'default'

const printFrameCounts = (label: string, commandProbes: CommandProbe[]) => {
  console.info(`${label} frame counts:`)
  for (const commandProbe of commandProbes) {
    const summary = commandProbe.probes
      .map((probe) => {
        const stream = formatStream(probe.streamSpecifier)
        return probe.error
          ? `${stream}: error: ${probe.error}`
          : `${stream}: ${probe.frameCount} frame(s)`
      })
      .join('; ')

    console.info(
      `- ${commandProbe.command}: ${summary}`
    )
  }
}

const hasAnimatedFrames = (commandProbe: CommandProbe) =>
  commandProbe.probes.some(
    (probe) => probe.frameCount !== undefined && probe.frameCount > 1
  )

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

const animatedOutputCommandProbe = outputProbes.find(hasAnimatedFrames)
const animatedOutputProbe = animatedOutputCommandProbe?.probes.find(
  (probe) => probe.frameCount !== undefined && probe.frameCount > 1
)

if (!animatedOutputProbe) {
  console.error(
    `Generated thumbnail is not animated by any ffmpeg command: ${thumbnail.byteLength} bytes at ${outputPath}.`
  )
  process.exit(1)
}

console.log(
  `Wrote animated AVIF thumbnail: ${thumbnail.byteLength} bytes, ${animatedOutputProbe.frameCount} frames to ${outputPath}`
)
