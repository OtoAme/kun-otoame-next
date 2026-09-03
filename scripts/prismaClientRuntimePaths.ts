import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
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

const assertFile = (path: string, label: string) => {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} is missing: ${path}`)
  }
  return path
}

const readPackageDependencies = (packageDir: string) => {
  const manifest = JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8')
  ) as { dependencies?: Record<string, string> }
  return Object.keys(manifest.dependencies ?? {})
}

const copyRealPackage = (source: string, destination: string) => {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, dereference: true })
  if (!existsSync(destination) || !lstatSync(destination).isDirectory()) {
    throw new Error(`Copied package is missing: ${destination}`)
  }
  return destination
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

export const copyPrismaClientRuntimePackage = (
  sourceNodeModules: string,
  destinationNodeModules: string
) => {
  const { clientPackage } = resolvePrismaClientRuntimePaths(sourceNodeModules)
  const destination = copyRealPackage(
    clientPackage,
    join(destinationNodeModules, '@prisma', 'client')
  )
  // pnpm resolves the runtime dependencies of @prisma/client (currently
  // @prisma/client-runtime-utils) from the store directory beside the real
  // package. A flattened copy has to carry them beside itself instead.
  const storeNodeModules = dirname(dirname(clientPackage))
  for (const dependency of readPackageDependencies(clientPackage)) {
    copyRealPackage(
      assertDirectory(
        join(storeNodeModules, dependency),
        `@prisma/client dependency ${dependency}`
      ),
      join(destinationNodeModules, dependency)
    )
  }
  return destination
}

export const assertGeneratedPrismaClient = (nodeModules: string) => {
  const generatedClient = assertDirectory(
    join(nodeModules, '.prisma', 'client'),
    'Generated Prisma Client'
  )
  for (const entry of ['default.js', 'index.js']) {
    assertFile(join(generatedClient, entry), `Generated Prisma Client ${entry}`)
  }
  return generatedClient
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
