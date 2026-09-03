import { config } from 'dotenv'
import {
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { IncomingMessage } from 'node:http'
import https from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { envSchema } from '../validations/dotenv-check'
import { activateReleaseWithReadiness } from './deployActivation'
import { acquireDeployLock, assertInheritedDeployLock } from './deployLock'
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
  getPinnedCommitRef,
  getPinnedFetchArgs,
  normalizeCommitSha,
  readReleaseManifest,
  verifyReleaseIdentity
} from './deployReleaseSafety'
import {
  getReleaseApiPath,
  selectReleaseAsset,
  type GitHubRelease
} from './deployReleaseSelection'
import {
  adoptLegacyDeploySlot,
  getDeploySlotPaths,
  installCandidateRelease,
  recoverInterruptedActivation
} from './deploySlots'
import {
  assertGeneratedPrismaClient,
  assertSamePrismaSchema,
  backupGeneratedPrismaClient,
  copyGeneratedPrismaClient,
  copyPrismaClientRuntimePackage,
  restoreGeneratedPrismaClient
} from './prismaClientRuntimePaths'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(projectRoot, '.env')

type DeployMode = {
  release: 'latest' | 'pinned'
  lockHeld: boolean
}

const parseMode = (args: string[]): DeployMode => {
  const lockArguments = args.filter((argument) => argument === '--lock-held')
  if (lockArguments.length > 1) {
    throw new Error('The deploy pull lock marker may only be supplied once.')
  }

  const releaseArguments = args.filter((argument) => argument !== '--lock-held')
  if (releaseArguments.length === 0) {
    return { release: 'latest', lockHeld: lockArguments.length === 1 }
  }
  if (releaseArguments.length === 1 && releaseArguments[0] === '--pinned') {
    return { release: 'pinned', lockHeld: lockArguments.length === 1 }
  }
  throw new Error(`Unknown deploy pull arguments: ${args.join(' ')}`)
}

const downloadFile = (
  url: string,
  destination: string,
  headers: Record<string, string> = {}
): Promise<void> =>
  new Promise((resolveDownload, reject) => {
    const requestUrl = new URL(url)
    const request = https.get(
      {
        hostname: requestUrl.hostname,
        path: requestUrl.pathname + requestUrl.search,
        headers: { ...headers, 'User-Agent': 'OtoAme deployment' }
      },
      (response: IncomingMessage) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          response.resume()
          const redirect = response.headers.location
          if (!redirect) {
            reject(new Error('Release download redirect has no location.'))
            return
          }
          const redirectedUrl = new URL(redirect)
          const redirectedHeaders = { ...headers }
          if (redirectedUrl.hostname !== requestUrl.hostname) {
            delete redirectedHeaders.Authorization
          }
          downloadFile(redirect, destination, redirectedHeaders)
            .then(resolveDownload)
            .catch(reject)
          return
        }
        if (response.statusCode !== 200) {
          response.resume()
          reject(
            new Error(`Download failed with status ${response.statusCode}`)
          )
          return
        }

        const file = createWriteStream(destination, {
          flags: 'wx',
          mode: 0o600
        })
        response.pipe(file)
        file.on('finish', () => file.close(() => resolveDownload()))
        file.on('error', reject)
      }
    )
    request.on('error', reject)
  })

const getRelease = async (
  repo: string,
  expectedTag?: string
): Promise<{ downloadUrl: string; tag: string }> =>
  new Promise((resolveRelease, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'OtoAme deployment'
    }
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${process.env.GITHUB_TOKEN}`
    }

    https
      .get(
        {
          hostname: 'api.github.com',
          path: getReleaseApiPath(repo, expectedTag),
          headers
        },
        (response) => {
          let data = ''
          response.on('data', (chunk) => (data += String(chunk)))
          response.on('end', () => {
            if (response.statusCode !== 200) {
              reject(
                new Error(`GitHub API returned ${response.statusCode}: ${data}`)
              )
              return
            }
            try {
              const release = JSON.parse(data) as GitHubRelease
              resolveRelease({
                downloadUrl: selectReleaseAsset(release, expectedTag),
                tag: release.tag_name
              })
            } catch (error) {
              reject(error)
            }
          })
        }
      )
      .on('error', reject)
  })

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

const runCandidatePrismaGuard = (candidateRoot: string) => {
  const schemaPath = join(candidateRoot, 'prisma', 'schema')
  if (!existsSync(schemaPath) || !lstatSync(schemaPath).isDirectory()) {
    throw new Error('Release artifact is missing prisma/schema.')
  }

  runDeployCommand('pnpm', ['migration:resource-links'], { cwd: projectRoot })
  runDeployCommand(
    'pnpm',
    [
      'exec',
      'esno',
      'scripts/checkPrismaProductionSchema.ts',
      `--schema=${schemaPath}`,
      `--candidate-root=${candidateRoot}`
    ],
    { cwd: projectRoot }
  )
}

const generatePrismaClientForCandidate = (candidateRoot: string) => {
  // Prisma resolves both the CLI and @prisma/client upwards from the schema
  // directory and refuses to generate when they live in different
  // node_modules trees. A candidate below the project root always resolves
  // the CLI from the root, so `prisma generate --schema=<candidate>` cannot
  // target the candidate. The verified release identity makes the candidate
  // schema byte-identical to the checked-out schema: assert that, generate
  // with the server toolchain at the root, then materialize the result.
  assertSamePrismaSchema(
    resolve(projectRoot, 'prisma', 'schema'),
    join(candidateRoot, 'prisma', 'schema')
  )
  runDeployCommand('pnpm', ['exec', 'prisma', 'generate'], {
    cwd: projectRoot
  })
}

const materializeCandidatePrismaClient = (candidateRoot: string) => {
  const rootNodeModules = resolve(projectRoot, 'node_modules')
  const candidateNodeModules = join(candidateRoot, 'node_modules')
  copyGeneratedPrismaClient(rootNodeModules, candidateNodeModules)
  copyPrismaClientRuntimePackage(rootNodeModules, candidateNodeModules)
  assertGeneratedPrismaClient(candidateNodeModules)
}

const injectRuntimeDependencies = (candidateRoot: string) => {
  const rootNodeModules = resolve(projectRoot, 'node_modules')
  const candidateNodeModules = join(candidateRoot, 'node_modules')
  copyPackage(rootNodeModules, candidateNodeModules, 'ffmpeg-static')
  for (const required of [
    '.prisma/client',
    '@prisma/client',
    'ffmpeg-static'
  ]) {
    const target = join(candidateNodeModules, required)
    if (!existsSync(target) || !lstatSync(target).isDirectory()) {
      throw new Error(`Injected runtime package is missing: ${required}`)
    }
  }

  const rootGalleryFfmpeg = join(rootNodeModules, '.ffmpeg', 'ffmpeg')
  if (existsSync(rootGalleryFfmpeg)) {
    const destination = join(candidateRoot, '.ffmpeg', 'ffmpeg')
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(rootGalleryFfmpeg, destination)
    runDeployCommand('chmod', ['755', destination])
  }
}

const preflightCandidatePrismaClient = (candidateRoot: string) => {
  // Resolve the client from the candidate root exactly like the standalone
  // server will, before PM2 ever starts it.
  runDeployCommand(
    'node',
    ['--input-type=commonjs', '-e', "require('@prisma/client')"],
    { cwd: candidateRoot }
  )
}

const generateCandidateSitemap = (candidateRoot: string) => {
  try {
    runDeployCommand(
      'pnpm',
      ['exec', 'esno', 'scripts/generateKunSitemap.ts'],
      {
        cwd: projectRoot
      }
    )
    const generated = resolve(projectRoot, 'public/sitemap.xml')
    if (existsSync(generated)) {
      const destination = join(candidateRoot, 'public/sitemap.xml')
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(generated, destination)
    }
  } catch (error) {
    console.error('Sitemap generation failed; deployment will continue:', error)
  }
}

const main = async () => {
  const mode = parseMode(process.argv.slice(2))
  if (!existsSync(envPath))
    throw new Error('.env file not found in project root.')
  config({ path: envPath })
  const parsedEnv = envSchema.safeParse(process.env)
  if (!parsedEnv.success) {
    throw new Error('Production environment validation failed.')
  }

  const repo = process.env.GITHUB_REPO
  if (!repo) throw new Error('GITHUB_REPO is required for release deployment.')

  const slots = getDeploySlotPaths(projectRoot)
  if (mode.lockHeld) assertInheritedDeployLock(slots.deployRoot)
  const releaseLock = mode.lockHeld
    ? () => undefined
    : acquireDeployLock(slots.deployRoot)
  try {
    const interruptedRelease = recoverInterruptedActivation(slots)
    if (interruptedRelease) {
      await restartAndVerifyProduction({ standaloneDir: interruptedRelease })
    }
    adoptLegacyDeploySlot(slots)

    assertCleanDeployWorktree(projectRoot)
    const headCommit = normalizeCommitSha(
      readDeployCommand('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })
    )
    const expectedTag =
      mode.release === 'pinned'
        ? process.env.KUN_DEPLOY_RELEASE_TAG?.trim()
        : undefined
    if (mode.release === 'pinned' && !expectedTag) {
      throw new Error('Pinned deployment requires KUN_DEPLOY_RELEASE_TAG.')
    }

    let tagCommit: string | undefined
    if (expectedTag) {
      runDeployCommand('git', getPinnedFetchArgs(expectedTag), {
        cwd: projectRoot
      })
      tagCommit = normalizeCommitSha(
        readDeployCommand(
          'git',
          ['rev-parse', getPinnedCommitRef(expectedTag)],
          {
            cwd: projectRoot
          }
        )
      )
      if (tagCommit !== headCommit) {
        throw new Error(
          `Pinned deployment HEAD mismatch: HEAD=${headCommit}, tag=${tagCommit}`
        )
      }
    }

    const release = await getRelease(repo, expectedTag)
    if (!expectedTag) {
      runDeployCommand('git', getPinnedFetchArgs(release.tag), {
        cwd: projectRoot
      })
      tagCommit = normalizeCommitSha(
        readDeployCommand(
          'git',
          ['rev-parse', getPinnedCommitRef(release.tag)],
          {
            cwd: projectRoot
          }
        )
      )
      if (tagCommit !== headCommit) {
        throw new Error(
          `Latest deployment HEAD mismatch: HEAD=${headCommit}, tag=${tagCommit}`
        )
      }
    }
    const nextRoot = resolve(projectRoot, '.next')
    const candidateRoot = join(nextRoot, `deploy-candidate-${process.pid}`)
    const archivePath = join(nextRoot, `release-${process.pid}.tar.gz`)
    const clientBackupRoot = join(slots.deployRoot, 'transient-client-backup')
    rmSync(candidateRoot, { recursive: true, force: true })
    rmSync(archivePath, { force: true })
    mkdirSync(candidateRoot, { recursive: true, mode: 0o700 })

    const headers: Record<string, string> = {}
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${process.env.GITHUB_TOKEN}`
    }

    let deploymentSucceeded = false
    let clientBackedUp = false
    try {
      backupGeneratedPrismaClient(
        resolve(projectRoot, 'node_modules'),
        clientBackupRoot
      )
      clientBackedUp = true
      runDeployCommand(
        'pnpm',
        ['install', '--frozen-lockfile', '--ignore-scripts'],
        {
          cwd: projectRoot
        }
      )
      await downloadFile(release.downloadUrl, archivePath, headers)
      runDeployCommand('tar', ['-xzf', archivePath, '-C', candidateRoot])

      const manifestPath = join(candidateRoot, 'release-manifest.json')
      if (
        !existsSync(manifestPath) ||
        !lstatSync(manifestPath).isFile() ||
        lstatSync(manifestPath).isSymbolicLink()
      ) {
        throw new Error(
          'Release artifact has no regular release-manifest.json.'
        )
      }
      const manifest = readReleaseManifest(manifestPath)
      verifyReleaseIdentity({
        expectedTag,
        releaseTag: release.tag,
        headCommit,
        tagCommit,
        manifest
      })

      runCandidatePrismaGuard(candidateRoot)
      runDeployCommand('pnpm', ['rebuild', '--pending'], {
        cwd: projectRoot
      })
      generatePrismaClientForCandidate(candidateRoot)
      materializeCandidatePrismaClient(candidateRoot)
      injectRuntimeDependencies(candidateRoot)
      preflightCandidatePrismaClient(candidateRoot)
      generateCandidateSitemap(candidateRoot)
      validateStandaloneRuntime(candidateRoot)

      const candidateRelease = installCandidateRelease(
        slots,
        candidateRoot,
        `${manifest.commitSha}-${manifest.tag}`
      )
      validateStandaloneRuntime(candidateRelease)
      const installedManifest = readReleaseManifest(
        join(candidateRelease, 'release-manifest.json')
      )
      verifyReleaseIdentity({
        expectedTag,
        releaseTag: release.tag,
        headCommit,
        tagCommit,
        manifest: installedManifest
      })
      await activateReleaseWithReadiness({
        paths: slots,
        candidateRelease,
        preflightRelease: validateStandaloneRuntime,
        verifyReadiness: (releasePath) =>
          restartAndVerifyProduction({ standaloneDir: releasePath })
      })
      deploymentSucceeded = true

      unlinkSync(archivePath)
      console.log(
        `Deployment ${manifest.tag} (${manifest.commitSha}) activated; previous slot retained for offline rollback.`
      )
    } finally {
      if (!deploymentSucceeded) {
        rmSync(candidateRoot, { recursive: true, force: true })
      }
      if (!deploymentSucceeded && clientBackedUp) {
        restoreGeneratedPrismaClient(
          resolve(projectRoot, 'node_modules'),
          clientBackupRoot
        )
      }
      rmSync(clientBackupRoot, { recursive: true, force: true })
      rmSync(archivePath, { force: true })
    }
  } finally {
    releaseLock()
  }
}

main().catch((error) => {
  console.error('Deployment failed:', error)
  process.exitCode = 1
})
