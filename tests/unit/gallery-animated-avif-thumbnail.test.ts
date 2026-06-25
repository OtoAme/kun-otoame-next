import { EventEmitter } from 'node:events'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn())
const ffmpegStaticMock = vi.hoisted((): { default: string | null } => ({
  default: '/bundled/ffmpeg'
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

vi.mock('node:module', () => ({
  createRequire: () => () => ffmpegStaticMock.default
}))

import {
  createAnimatedAvifThumbnail,
  getGalleryFfmpegCommands
} from '~/app/api/edit/galleryAnimatedAvifThumbnail'

const createChildProcess = (
  args: string[],
  handler: (
    outputPath: string
  ) => Promise<number | { code: number; stderr?: string }>
) => {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stderr = new EventEmitter()
  child.kill = vi.fn()

  setImmediate(async () => {
    const result = await handler(args[args.length - 1])
    if (typeof result === 'number') {
      child.emit('close', result)
      return
    }

    if (result.stderr) {
      child.stderr.emit('data', result.stderr)
    }
    child.emit('close', result.code)
  })

  return child
}

describe('animated AVIF thumbnail adapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ffmpegStaticMock.default = '/bundled/ffmpeg'
    existsSyncMock.mockReturnValue(false)
    delete process.env.KUN_GALLERY_FFMPEG_PATH
  })

  it('prefers an explicit gallery ffmpeg path while keeping fallback commands', async () => {
    process.env.KUN_GALLERY_FFMPEG_PATH = '/custom/ffmpeg'
    existsSyncMock.mockImplementation((targetPath: string) => {
      return targetPath === '/custom/ffmpeg'
    })

    await expect(getGalleryFfmpegCommands()).resolves.toEqual([
      '/custom/ffmpeg',
      '/bundled/ffmpeg',
      'ffmpeg'
    ])
  })

  it('finds the standalone packaged ffmpeg binary before ffmpeg-static', async () => {
    const standaloneFfmpeg = path.join(process.cwd(), '.ffmpeg', 'ffmpeg')
    existsSyncMock.mockImplementation((targetPath: string) => {
      return targetPath === standaloneFfmpeg
    })

    await expect(getGalleryFfmpegCommands()).resolves.toEqual([
      standaloneFfmpeg,
      '/bundled/ffmpeg',
      'ffmpeg'
    ])
  })

  it('keeps ffmpeg-static fallback after the optional local binary', async () => {
    const localFfmpeg = path.join(
      process.cwd(),
      'node_modules',
      '.ffmpeg',
      'ffmpeg'
    )
    existsSyncMock.mockImplementation((targetPath: string) => {
      return targetPath === localFfmpeg
    })

    await expect(getGalleryFfmpegCommands()).resolves.toEqual([
      localFfmpeg,
      '/bundled/ffmpeg',
      'ffmpeg'
    ])
  })

  it('returns an animated AVIF thumbnail when ffmpeg animated encoding succeeds', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) =>
      createChildProcess(args, async (outputPath) => {
        if (args.includes('showinfo')) {
          return { code: 0, stderr: 'n:   0\nn:   1\n' }
        }

        await writeFile(outputPath, Buffer.from('animated-thumbnail'))
        return 0
      })
    )

    const result = await createAnimatedAvifThumbnail(Buffer.from('avif'))

    expect(result).toEqual(Buffer.from('animated-thumbnail'))
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[0][0]).toBe('/bundled/ffmpeg')
    expect(spawnMock.mock.calls[0][1]).not.toContain('-frames:v')
  })

  it('falls back to the system ffmpeg command when bundled ffmpeg fails', async () => {
    spawnMock
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async () => 1)
      )
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async (outputPath) => {
          await writeFile(outputPath, Buffer.from('system-thumbnail'))
          return 0
        })
      )
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async () => {
          return { code: 0, stderr: 'n:   0\nn:   1\n' }
        })
      )

    const result = await createAnimatedAvifThumbnail(Buffer.from('avif'))

    expect(result).toEqual(Buffer.from('system-thumbnail'))
    expect(spawnMock).toHaveBeenCalledTimes(3)
    expect(spawnMock.mock.calls[0][0]).toBe('/bundled/ffmpeg')
    expect(spawnMock.mock.calls[1][0]).toBe('ffmpeg')
  })

  it('uses system ffmpeg directly when bundled ffmpeg is unavailable', async () => {
    ffmpegStaticMock.default = null
    spawnMock.mockImplementation((_command: string, args: string[]) =>
      createChildProcess(args, async (outputPath) => {
        if (args.includes('showinfo')) {
          return { code: 0, stderr: 'n:   0\nn:   1\n' }
        }

        await writeFile(outputPath, Buffer.from('system-only-thumbnail'))
        return 0
      })
    )

    const result = await createAnimatedAvifThumbnail(Buffer.from('avif'))

    expect(result).toEqual(Buffer.from('system-only-thumbnail'))
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[0][0]).toBe('ffmpeg')
  })

  it('falls back to a real first-frame AVIF thumbnail when animated encoding fails', async () => {
    spawnMock
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async () => 1)
      )
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async () => 1)
      )
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async (outputPath) => {
          await writeFile(outputPath, Buffer.from('first-frame-thumbnail'))
          return 0
        })
      )

    const result = await createAnimatedAvifThumbnail(Buffer.from('avif'))

    expect(result).toEqual(Buffer.from('first-frame-thumbnail'))
    expect(spawnMock).toHaveBeenCalledTimes(3)
    expect(spawnMock.mock.calls[0][0]).toBe('/bundled/ffmpeg')
    expect(spawnMock.mock.calls[1][0]).toBe('ffmpeg')
    expect(spawnMock.mock.calls[2][0]).toBe('/bundled/ffmpeg')
    expect(spawnMock.mock.calls[2][1]).toContain('-frames:v')
  })

  it('returns null when neither animated nor first-frame encoding succeeds', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    spawnMock.mockImplementation((_command: string, args: string[]) =>
      createChildProcess(args, async () => 1)
    )

    await expect(
      createAnimatedAvifThumbnail(Buffer.from('avif'))
    ).resolves.toBeNull()
    expect(spawnMock).toHaveBeenCalledTimes(4)
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Animated AVIF thumbnail generation failed for all commands:'
      )
    )
    consoleWarn.mockRestore()
  })

  it('tries the first-frame fallback when animated output exceeds the size limit', async () => {
    spawnMock
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async (outputPath) => {
          await writeFile(outputPath, Buffer.alloc(512 * 1024 + 1))
          return 0
        })
      )
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async (outputPath) => {
          await writeFile(outputPath, Buffer.from('system-thumbnail'))
          return 0
        })
      )
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async () => {
          return { code: 0, stderr: 'n:   0\nn:   1\n' }
        })
      )

    const result = await createAnimatedAvifThumbnail(Buffer.from('avif'))

    expect(result).toEqual(Buffer.from('system-thumbnail'))
    expect(spawnMock).toHaveBeenCalledTimes(3)
  })

  it('tries the first-frame fallback when animated output has one frame', async () => {
    spawnMock
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async (outputPath) => {
          await writeFile(outputPath, Buffer.from('single-frame-output'))
          return 0
        })
      )
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async () => {
          return { code: 0, stderr: 'n:   0\n' }
        })
      )
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async () => 1)
      )
      .mockImplementationOnce((_command: string, args: string[]) =>
        createChildProcess(args, async (outputPath) => {
          await writeFile(outputPath, Buffer.from('first-frame-thumbnail'))
          return 0
        })
      )

    const result = await createAnimatedAvifThumbnail(Buffer.from('avif'))

    expect(result).toEqual(Buffer.from('first-frame-thumbnail'))
    expect(spawnMock).toHaveBeenCalledTimes(4)
    expect(spawnMock.mock.calls[0][1]).not.toContain('-frames:v')
    expect(spawnMock.mock.calls[1][1]).toContain('showinfo')
    expect(spawnMock.mock.calls[3][1]).toContain('-frames:v')
  })
})
