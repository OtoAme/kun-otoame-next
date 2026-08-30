import {
  accessSync,
  constants,
  lstatSync,
  readdirSync,
  realpathSync
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export type PrismaSchemaCliOptions = {
  schemaPath: string
  candidateRoot: string | null
  isCandidate: boolean
}

const parseSingleValue = (
  args: string[],
  name: '--schema' | '--candidate-root'
) => {
  const prefix = `${name}=`
  const values = args
    .filter((arg) => arg.startsWith(prefix))
    .map((arg) => arg.slice(prefix.length))

  if (values.length > 1) {
    throw new Error(`Duplicate ${name} argument.`)
  }
  if (values[0] === '') {
    throw new Error(`${name} must not be empty.`)
  }
  return values[0]
}

const assertNoSymbolicLinks = (root: string) => {
  const visit = (current: string) => {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Prisma candidate path must not contain symlinks: ${current}`
      )
    }
    if (!stat.isDirectory()) return
    for (const entry of readdirSync(current)) {
      visit(join(current, entry))
    }
  }
  visit(root)
}

const isWithin = (parent: string, child: string) => {
  const nested = relative(parent, child)
  return nested === '' || (!nested.startsWith(`..${sep}`) && nested !== '..')
}

export const resolvePrismaSchemaCliOptions = ({
  args,
  projectRoot
}: {
  args: string[]
  projectRoot: string
}): PrismaSchemaCliOptions => {
  for (const arg of args) {
    if (!arg.startsWith('--schema=') && !arg.startsWith('--candidate-root=')) {
      throw new Error(`Unknown production schema guard argument: ${arg}`)
    }
  }

  const schemaArg = parseSingleValue(args, '--schema')
  const candidateRootArg = parseSingleValue(args, '--candidate-root')

  if (!schemaArg && candidateRootArg) {
    throw new Error('--candidate-root requires --schema.')
  }

  if (!schemaArg) {
    const schemaPath = resolve(projectRoot, 'prisma/schema')
    accessSync(schemaPath, constants.R_OK)
    return { schemaPath, candidateRoot: null, isCandidate: false }
  }

  if (!candidateRootArg) {
    throw new Error('A candidate --schema requires --candidate-root.')
  }
  if (!isAbsolute(schemaArg) || !isAbsolute(candidateRootArg)) {
    throw new Error('Candidate schema and root paths must be absolute.')
  }

  const unresolvedCandidateRoot = resolve(candidateRootArg)
  const unresolvedSchemaPath = resolve(schemaArg)
  if (lstatSync(unresolvedCandidateRoot).isSymbolicLink()) {
    throw new Error('Candidate root must not be a symbolic link.')
  }
  if (
    lstatSync(join(unresolvedCandidateRoot, 'prisma')).isSymbolicLink() ||
    lstatSync(unresolvedSchemaPath).isSymbolicLink()
  ) {
    throw new Error('Candidate Prisma path must not contain symbolic links.')
  }
  const candidateRoot = realpathSync(unresolvedCandidateRoot)
  const schemaPath = realpathSync(unresolvedSchemaPath)
  const expectedSchemaPath = realpathSync(join(candidateRoot, 'prisma/schema'))

  if (
    !isWithin(candidateRoot, schemaPath) ||
    schemaPath !== expectedSchemaPath
  ) {
    throw new Error(
      'Candidate schema must be the prisma/schema directory inside the candidate root.'
    )
  }

  assertNoSymbolicLinks(join(candidateRoot, 'prisma/schema'))
  accessSync(schemaPath, constants.R_OK)

  return { schemaPath, candidateRoot, isCandidate: true }
}

export const buildPrismaDiffArgs = (schemaPath: string) => [
  'exec',
  'prisma',
  'migrate',
  'diff',
  '--exit-code',
  '--from-config-datasource',
  `--to-schema=${schemaPath}`,
  '--script'
]
