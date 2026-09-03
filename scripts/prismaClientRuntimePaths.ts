import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname, join, relative } from 'node:path'

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

export const copyGeneratedPrismaClient = (
  rootNodeModules: string,
  destinationNodeModules: string
) => {
  const { generatedPackage } = resolvePrismaClientRuntimePaths(rootNodeModules)
  return copyRealPackage(
    generatedPackage,
    join(destinationNodeModules, '.prisma')
  )
}

const listPrismaSchemaFiles = (schemaDir: string) => {
  const files: string[] = []
  const pending = [schemaDir]
  while (pending.length) {
    const directory = pending.pop()!
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(target)
      } else if (entry.isFile() && entry.name.endsWith('.prisma')) {
        files.push(relative(schemaDir, target))
      }
    }
  }
  return files.sort()
}

export const assertSamePrismaSchema = (
  expectedSchemaDir: string,
  candidateSchemaDir: string
) => {
  const expected = listPrismaSchemaFiles(expectedSchemaDir)
  const candidate = listPrismaSchemaFiles(candidateSchemaDir)
  if (expected.length === 0) {
    throw new Error(`Prisma schema has no .prisma files: ${expectedSchemaDir}`)
  }
  if (expected.join('\n') !== candidate.join('\n')) {
    throw new Error(
      'Candidate Prisma schema files differ from the checked-out schema.'
    )
  }
  for (const file of expected) {
    const expectedSource = readFileSync(join(expectedSchemaDir, file))
    const candidateSource = readFileSync(join(candidateSchemaDir, file))
    if (!expectedSource.equals(candidateSource)) {
      throw new Error(
        `Candidate Prisma schema differs from the checked-out schema: ${file}`
      )
    }
  }
  return expected
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
