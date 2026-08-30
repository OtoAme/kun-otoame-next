import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname, join } from 'node:path'

const assertDirectory = (path: string, label: string) => {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} is missing: ${path}`)
  }
  return path
}

export const resolvePrismaClientRuntimePaths = (rootNodeModules: string) => {
  const clientEntry = assertDirectory(
    join(rootNodeModules, '@prisma/client'),
    '@prisma/client package'
  )
  const clientPackage = realpathSync(clientEntry)
  const generatedPackage = assertDirectory(
    join(dirname(dirname(clientPackage)), '.prisma'),
    'Generated .prisma package'
  )
  assertDirectory(join(generatedPackage, 'client'), 'Generated Prisma Client')
  return { clientPackage, generatedPackage }
}

export const backupGeneratedPrismaClient = (
  rootNodeModules: string,
  backupRoot: string
) => {
  const { generatedPackage } = resolvePrismaClientRuntimePaths(rootNodeModules)
  rmSync(backupRoot, { recursive: true, force: true })
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
  cpSync(generatedPackage, join(backupRoot, '.prisma'), {
    recursive: true,
    dereference: true
  })
}

export const restoreGeneratedPrismaClient = (
  rootNodeModules: string,
  backupRoot: string
) => {
  const { generatedPackage } = resolvePrismaClientRuntimePaths(rootNodeModules)
  const backup = assertDirectory(
    join(backupRoot, '.prisma'),
    'Generated Prisma Client backup'
  )
  assertDirectory(
    join(backup, 'client'),
    'Generated Prisma Client backup client'
  )
  rmSync(generatedPackage, { recursive: true, force: true })
  cpSync(backup, generatedPackage, {
    recursive: true,
    dereference: true
  })
}
