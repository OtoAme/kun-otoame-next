import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertGeneratedPrismaClient,
  assertSamePrismaSchema,
  backupGeneratedPrismaClient,
  copyGeneratedPrismaClient,
  copyPrismaClientRuntimePackage,
  resolvePrismaClientRuntimePaths,
  restoreGeneratedPrismaClient
} from '~/scripts/prismaClientRuntimePaths'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('pnpm Prisma Client runtime paths', () => {
  it('finds generated .prisma beside the real @prisma/client package', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-prisma-runtime-'))
    roots.push(root)
    const nodeModules = join(root, 'node_modules')
    const storeNodeModules = join(root, 'store/node_modules')
    mkdirSync(join(nodeModules, '@prisma'), { recursive: true })
    mkdirSync(join(storeNodeModules, '@prisma/client'), { recursive: true })
    mkdirSync(join(storeNodeModules, '.prisma/client'), { recursive: true })
    symlinkSync(
      join(storeNodeModules, '@prisma/client'),
      join(nodeModules, '@prisma/client'),
      'dir'
    )

    expect(resolvePrismaClientRuntimePaths(nodeModules)).toEqual({
      clientPackage: realpathSync(join(storeNodeModules, '@prisma/client')),
      generatedPackage: realpathSync(join(storeNodeModules, '.prisma'))
    })
  })

  it('restores the exact generated client after a failed candidate operation', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-prisma-runtime-'))
    roots.push(root)
    const nodeModules = join(root, 'node_modules')
    const storeNodeModules = join(root, 'store/node_modules')
    const generatedClient = join(storeNodeModules, '.prisma/client')
    mkdirSync(join(nodeModules, '@prisma'), { recursive: true })
    mkdirSync(join(storeNodeModules, '@prisma/client'), { recursive: true })
    mkdirSync(generatedClient, { recursive: true })
    symlinkSync(
      join(storeNodeModules, '@prisma/client'),
      join(nodeModules, '@prisma/client'),
      'dir'
    )
    const marker = join(generatedClient, 'schema.marker')
    writeFileSync(marker, 'known-good')
    const backupRoot = join(root, 'backup')

    backupGeneratedPrismaClient(nodeModules, backupRoot)
    writeFileSync(marker, 'candidate')
    restoreGeneratedPrismaClient(nodeModules, backupRoot)

    expect(readFileSync(marker, 'utf8')).toBe('known-good')
  })

  it('copies the real client package without replacing sibling traced packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-prisma-runtime-'))
    roots.push(root)
    const sourceNodeModules = join(root, 'source/node_modules')
    const destinationNodeModules = join(root, 'destination/node_modules')
    const storeNodeModules = join(root, 'store/node_modules')
    const realClient = join(storeNodeModules, '@prisma/client')
    mkdirSync(join(sourceNodeModules, '@prisma'), { recursive: true })
    mkdirSync(join(storeNodeModules, '.prisma/client'), { recursive: true })
    mkdirSync(realClient, { recursive: true })
    writeFileSync(join(realClient, 'package.json'), '{}')
    symlinkSync(realClient, join(sourceNodeModules, '@prisma/client'), 'dir')
    const sibling = join(
      destinationNodeModules,
      '@prisma/client-runtime-utils/marker'
    )
    mkdirSync(join(destinationNodeModules, '@prisma/client-runtime-utils'), {
      recursive: true
    })
    writeFileSync(sibling, 'keep')

    const copied = copyPrismaClientRuntimePackage(
      sourceNodeModules,
      destinationNodeModules
    )

    expect(lstatSync(copied).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(copied, 'package.json'), 'utf8')).toBe('{}')
    expect(readFileSync(sibling, 'utf8')).toBe('keep')
  })

  it('flattens the declared @prisma/client dependencies beside the copied package', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-prisma-runtime-'))
    roots.push(root)
    const sourceNodeModules = join(root, 'source/node_modules')
    const destinationNodeModules = join(root, 'destination/node_modules')
    const storeNodeModules = join(root, 'store/node_modules')
    const realClient = join(storeNodeModules, '@prisma/client')
    const realUtils = join(
      root,
      'utils-store/node_modules/@prisma/client-runtime-utils'
    )
    mkdirSync(join(sourceNodeModules, '@prisma'), { recursive: true })
    mkdirSync(join(storeNodeModules, '.prisma/client'), { recursive: true })
    mkdirSync(realClient, { recursive: true })
    mkdirSync(realUtils, { recursive: true })
    writeFileSync(
      join(realClient, 'package.json'),
      JSON.stringify({
        dependencies: { '@prisma/client-runtime-utils': '7.8.0' }
      })
    )
    writeFileSync(join(realUtils, 'index.js'), 'module.exports = {}')
    symlinkSync(
      realUtils,
      join(storeNodeModules, '@prisma/client-runtime-utils'),
      'dir'
    )
    symlinkSync(realClient, join(sourceNodeModules, '@prisma/client'), 'dir')

    copyPrismaClientRuntimePackage(sourceNodeModules, destinationNodeModules)

    const copiedUtils = join(
      destinationNodeModules,
      '@prisma/client-runtime-utils'
    )
    expect(lstatSync(copiedUtils).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(copiedUtils, 'index.js'), 'utf8')).toBe(
      'module.exports = {}'
    )
  })

  it('fails when a declared @prisma/client dependency is missing from the store', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-prisma-runtime-'))
    roots.push(root)
    const sourceNodeModules = join(root, 'source/node_modules')
    const storeNodeModules = join(root, 'store/node_modules')
    const realClient = join(storeNodeModules, '@prisma/client')
    mkdirSync(join(sourceNodeModules, '@prisma'), { recursive: true })
    mkdirSync(join(storeNodeModules, '.prisma/client'), { recursive: true })
    mkdirSync(realClient, { recursive: true })
    writeFileSync(
      join(realClient, 'package.json'),
      JSON.stringify({
        dependencies: { '@prisma/client-runtime-utils': '7.8.0' }
      })
    )
    symlinkSync(realClient, join(sourceNodeModules, '@prisma/client'), 'dir')

    expect(() =>
      copyPrismaClientRuntimePackage(
        sourceNodeModules,
        join(root, 'destination/node_modules')
      )
    ).toThrow(
      '@prisma/client dependency @prisma/client-runtime-utils is missing'
    )
  })

  it('accepts only a generated client that has its runtime entry files', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-prisma-runtime-'))
    roots.push(root)
    const nodeModules = join(root, 'node_modules')
    const generatedClient = join(nodeModules, '.prisma/client')

    expect(() => assertGeneratedPrismaClient(nodeModules)).toThrow(
      'Generated Prisma Client is missing'
    )

    mkdirSync(generatedClient, { recursive: true })
    writeFileSync(join(generatedClient, 'default.js'), '')
    expect(() => assertGeneratedPrismaClient(nodeModules)).toThrow('index.js')

    writeFileSync(join(generatedClient, 'index.js'), '')
    expect(assertGeneratedPrismaClient(nodeModules)).toBe(generatedClient)
  })

  it('materializes the root generated client as a real directory in the destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-prisma-runtime-'))
    roots.push(root)
    const nodeModules = join(root, 'node_modules')
    const storeNodeModules = join(root, 'store/node_modules')
    const destinationNodeModules = join(root, 'destination/node_modules')
    mkdirSync(join(nodeModules, '@prisma'), { recursive: true })
    mkdirSync(join(storeNodeModules, '@prisma/client'), { recursive: true })
    mkdirSync(join(storeNodeModules, '.prisma/client'), { recursive: true })
    writeFileSync(join(storeNodeModules, '.prisma/client/default.js'), 'ok')
    symlinkSync(
      join(storeNodeModules, '@prisma/client'),
      join(nodeModules, '@prisma/client'),
      'dir'
    )

    const copied = copyGeneratedPrismaClient(
      nodeModules,
      destinationNodeModules
    )

    expect(copied).toBe(join(destinationNodeModules, '.prisma'))
    expect(lstatSync(copied).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(copied, 'client/default.js'), 'utf8')).toBe('ok')
  })

  it('accepts only a candidate schema that is byte-identical to the checked-out schema', () => {
    const root = mkdtempSync(join(tmpdir(), 'otoame-prisma-schema-'))
    roots.push(root)
    const expected = join(root, 'root/prisma/schema')
    const candidate = join(root, 'candidate/prisma/schema')
    mkdirSync(join(expected, 'models'), { recursive: true })
    mkdirSync(join(candidate, 'models'), { recursive: true })
    writeFileSync(join(expected, 'schema.prisma'), 'generator client {}')
    writeFileSync(join(candidate, 'schema.prisma'), 'generator client {}')
    writeFileSync(join(expected, 'models/user.prisma'), 'model user {}')
    writeFileSync(join(candidate, 'models/user.prisma'), 'model user {}')
    writeFileSync(join(candidate, 'README.md'), 'ignored')

    expect(assertSamePrismaSchema(expected, candidate)).toEqual([
      'models/user.prisma',
      'schema.prisma'
    ])

    writeFileSync(
      join(candidate, 'models/user.prisma'),
      'model user { id Int }'
    )
    expect(() => assertSamePrismaSchema(expected, candidate)).toThrow(
      'differs from the checked-out schema: models/user.prisma'
    )

    writeFileSync(join(candidate, 'models/user.prisma'), 'model user {}')
    writeFileSync(join(candidate, 'models/extra.prisma'), 'model extra {}')
    expect(() => assertSamePrismaSchema(expected, candidate)).toThrow(
      'schema files differ from the checked-out schema'
    )
  })
})
