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
  backupGeneratedPrismaClient,
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
})
