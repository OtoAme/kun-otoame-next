import { config } from 'dotenv'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envSchema } from '../validations/dotenv-check'
import { activateReleaseWithReadiness } from './deployActivation'
import {
  acquireDeployLock,
  assertInheritedDeployLock,
  DEPLOY_LOCK_OWNER_PID_ENV
} from './deployLock'
import {
  restartAndVerifyProduction,
  validateStandaloneRuntime
} from './deployPm2'
import {
  assertCleanDeployWorktree,
  readDeployCommand,
  runDeployCommand
} from './deployProcess'
import {
  RELEASE_MANIFEST_VERSION,
  normalizeCommitSha
} from './deployReleaseSafety'
import {
  adoptLegacyDeploySlot,
  getDeploySlotPaths,
  installCandidateRelease,
  recoverInterruptedActivation
} from './deploySlots'
import { resolvePrismaClientRuntimePaths } from './prismaClientRuntimePaths'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(projectRoot, '.env')
const lockHeldArgument = '--lock-held'

const copyPackage = (
  sourceNodeModules: string,
  destinationNodeModules: string,
  packageName: string
) => {
  const source = join(sourceNodeModules, packageName)
  const destination = join(destinationNodeModules, packageName)
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(`Required runtime package is missing: ${packageName}`)
  }
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, dereference: true })
}

const prepareLocalBuildCandidate = (candidateRoot: string) => {
  const rootNodeModules = resolve(projectRoot, 'node_modules')
  const candidateNodeModules = join(candidateRoot, 'node_modules')
  const { generatedPackage } = resolvePrismaClientRuntimePaths(rootNodeModules)

  rmSync(join(candidateNodeModules, '.prisma'), {
    recursive: true,
    force: true
  })
  cpSync(generatedPackage, join(candidateNodeModules, '.prisma'), {
    recursive: true,
    dereference: true
  })
  for (const packageName of ['@prisma', 'ffmpeg-static']) {
    copyPackage(rootNodeModules, candidateNodeModules, packageName)
  }

  cpSync(resolve(projectRoot, 'prisma'), join(candidateRoot, 'prisma'), {
    recursive: true,
    dereference: true
  })
  cpSync(
    resolve(projectRoot, '.next/server'),
    join(candidateRoot, '.next/server'),
    { recursive: true, dereference: true, force: true }
  )
  cpSync(
    resolve(projectRoot, '.next/BUILD_ID'),
    join(candidateRoot, '.next/BUILD_ID')
  )
}

const createLocalReleaseIdentity = (candidateRoot: string) => {
  const commitSha = normalizeCommitSha(
    readDeployCommand('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })
  )
  const tag = `local.${new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')}.${process.pid}`
  writeFileSync(
    join(candidateRoot, 'release-manifest.json'),
    `${JSON.stringify({
      version: RELEASE_MANIFEST_VERSION,
      tag,
      commitSha
    })}\n`,
    { flag: 'wx', mode: 0o600 }
  )
  return { commitSha, tag }
}

const loadProductionEnvironment = () => {
  if (!existsSync(envPath)) {
    throw new Error('.env file not found in the project root.')
  }
  config({ path: envPath })
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error('Production environment validation failed.')
  }

  if (process.env.KUN_VISUAL_NOVEL_TEST_SITE_LABEL) {
    console.warn(
      'DANGEROUS: this deployment is configured as a noindex test environment.'
    )
  }
}

const runLockedBuild = async () => {
  const slots = getDeploySlotPaths(projectRoot)
  assertCleanDeployWorktree(projectRoot)
  adoptLegacyDeploySlot(slots)

  runDeployCommand('pnpm', ['install', '--frozen-lockfile'], {
    cwd: projectRoot
  })
  runDeployCommand('pnpm', ['prisma:deploy-safe'], { cwd: projectRoot })

  // Next cleanDistDir removes .next. The durable release remains in .deploy;
  // remove only its compatibility symlink before the build starts.
  if (
    existsSync(slots.standaloneLink) &&
    lstatSync(slots.standaloneLink).isSymbolicLink()
  ) {
    unlinkSync(slots.standaloneLink)
  }

  let activated = false
  try {
    runDeployCommand('pnpm', ['build'], {
      cwd: projectRoot,
      env: { ...process.env, KUN_DEPLOY_BUILD_SKIP_CHECKS: 'true' }
    })

    const candidateRoot = resolve(projectRoot, '.next/standalone')
    prepareLocalBuildCandidate(candidateRoot)
    validateStandaloneRuntime(candidateRoot)
    const identity = createLocalReleaseIdentity(candidateRoot)
    const candidateRelease = installCandidateRelease(
      slots,
      candidateRoot,
      `${identity.commitSha}-${identity.tag}`
    )
    await activateReleaseWithReadiness({
      paths: slots,
      candidateRelease,
      preflightRelease: validateStandaloneRuntime,
      verifyReadiness: (releasePath) =>
        restartAndVerifyProduction({ standaloneDir: releasePath })
    })
    activated = true
    console.log(
      `Local build ${identity.tag} (${identity.commitSha}) activated; previous slot retained for offline rollback.`
    )
  } finally {
    if (!activated) {
      // Recreate .next/standalone -> .deploy/current after cleanDistDir or a
      // failed pre-activation build. Running PM2 instances use .deploy/current.
      if (
        existsSync(slots.standaloneLink) &&
        !lstatSync(slots.standaloneLink).isSymbolicLink()
      ) {
        rmSync(slots.standaloneLink, { recursive: true, force: true })
      }
      adoptLegacyDeploySlot(slots)
    }
  }
}

const main = async () => {
  loadProductionEnvironment()
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== lockHeldArgument)) {
    throw new Error(`Unknown deploy build arguments: ${args.join(' ')}`)
  }

  const slots = getDeploySlotPaths(projectRoot)
  if (args[0] === lockHeldArgument) {
    assertInheritedDeployLock(slots.deployRoot)
    await runLockedBuild()
    return
  }

  const releaseLock = acquireDeployLock(slots.deployRoot)
  try {
    const interruptedRelease = recoverInterruptedActivation(slots)
    if (interruptedRelease) {
      await restartAndVerifyProduction({ standaloneDir: interruptedRelease })
    }
    assertCleanDeployWorktree(projectRoot)
    validateStandaloneRuntime(adoptLegacyDeploySlot(slots))
    runDeployCommand('git', ['pull', '--ff-only'], { cwd: projectRoot })
    runDeployCommand(
      'pnpm',
      ['exec', 'esno', 'scripts/deployBuild.ts', lockHeldArgument],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          [DEPLOY_LOCK_OWNER_PID_ENV]: String(process.pid)
        }
      }
    )
  } finally {
    releaseLock()
  }
}

main().catch((error) => {
  console.error('Local build deployment failed:', error)
  process.exitCode = 1
})
