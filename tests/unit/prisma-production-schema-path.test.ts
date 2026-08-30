import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildPrismaDiffArgs,
  resolvePrismaSchemaCliOptions
} from '~/scripts/prismaProductionSchemaPath'

const temporaryRoots: string[] = []

const createProject = () => {
  const root = mkdtempSync(join(tmpdir(), 'otoame-prisma-path-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, 'prisma/schema'), { recursive: true })
  writeFileSync(join(root, 'prisma/schema/schema.prisma'), 'datasource db {}')
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('production Prisma schema path', () => {
  it('keeps the project schema as the default', () => {
    const projectRoot = createProject()
    expect(resolvePrismaSchemaCliOptions({ args: [], projectRoot })).toEqual({
      schemaPath: resolve(projectRoot, 'prisma/schema'),
      candidateRoot: null,
      isCandidate: false
    })
  })

  it('accepts only the prisma/schema directory inside an explicit candidate root', () => {
    const projectRoot = createProject()
    const candidateRoot = createProject()
    mkdirSync(join(candidateRoot, 'node_modules/example'), { recursive: true })

    const result = resolvePrismaSchemaCliOptions({
      args: [
        `--schema=${join(candidateRoot, 'prisma/schema')}`,
        `--candidate-root=${candidateRoot}`
      ],
      projectRoot
    })

    expect(result).toEqual({
      schemaPath: realpathSync(resolve(candidateRoot, 'prisma/schema')),
      candidateRoot: realpathSync(resolve(candidateRoot)),
      isCandidate: true
    })
    expect(buildPrismaDiffArgs(result.schemaPath)).toContain(
      `--to-schema=${result.schemaPath}`
    )
  })

  it.each([
    ['--unknown=value'],
    ['--schema=/tmp/a', '--schema=/tmp/b', '--candidate-root=/tmp'],
    ['--candidate-root=/tmp'],
    ['--schema=relative/prisma/schema', '--candidate-root=/tmp']
  ])('rejects invalid arguments: %o', (...args) => {
    const projectRoot = createProject()
    expect(() => resolvePrismaSchemaCliOptions({ args, projectRoot })).toThrow()
  })

  it('rejects schemas outside the candidate and symbolic links inside schema', () => {
    const projectRoot = createProject()
    const candidateRoot = createProject()
    const outside = createProject()

    expect(() =>
      resolvePrismaSchemaCliOptions({
        args: [
          `--schema=${join(outside, 'prisma/schema')}`,
          `--candidate-root=${candidateRoot}`
        ],
        projectRoot
      })
    ).toThrow('prisma/schema directory inside the candidate root')

    symlinkSync(
      join(outside, 'prisma/schema/schema.prisma'),
      join(candidateRoot, 'prisma/schema/linked.prisma')
    )
    expect(() =>
      resolvePrismaSchemaCliOptions({
        args: [
          `--schema=${join(candidateRoot, 'prisma/schema')}`,
          `--candidate-root=${candidateRoot}`
        ],
        projectRoot
      })
    ).toThrow('must not contain symlinks')
  })
})
