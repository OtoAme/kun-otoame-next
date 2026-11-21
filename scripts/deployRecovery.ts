import { existsSync } from 'node:fs'
import { activateReleaseWithReadiness } from './deployActivation'
import { acquireDeployLock } from './deployLock'
import { restartAndVerifyProduction } from './deployPm2'
import {
  formatRecoveryState,
  inspectRecoveryRelease,
  listRecoveryReleases,
  recoverySelectionSnapshot
} from './deployRecoveryInfo'
import {
  getCurrentDeployRelease,
  getDeploySlotPaths,
  getPreviousDeployRelease,
  readActivationJournal
} from './deploySlots'

export const parseRecoveryArguments = (args: string[]) => {
  if (args.length === 0) return { mode: 'interactive' as const }
  if (args.length === 1 && args[0] === '--list')
    return { mode: 'list' as const }
  if (args.length === 2 && args[0] === '--preview')
    return { mode: 'preview' as const, releaseId: args[1] }
  if (
    args.length === 4 &&
    args[0] === '--release' &&
    args[2] === '--confirm' &&
    args[1] === args[3]
  ) {
    return { mode: 'execute' as const, releaseId: args[1] }
  }
  throw new Error(
    'Use --list, --preview <release-id>, or --release <release-id> --confirm <same-release-id>. No default target or generic --yes is accepted.'
  )
}

export const runDeployRecovery = async ({
  projectRoot,
  args,
  isTTY,
  ask,
  log = console.log,
  prepare = () => undefined,
  activate = activateReleaseWithReadiness
}: {
  projectRoot: string
  args: string[]
  isTTY: boolean
  ask: (prompt: string) => Promise<string | null>
  log?: (message: string) => void
  prepare?: () => void
  activate?: typeof activateReleaseWithReadiness
}) => {
  const mode = parseRecoveryArguments(args)
  const paths = getDeploySlotPaths(projectRoot)
  if (!existsSync(paths.deployRoot))
    throw new Error(
      'No managed deployment exists; no recovery state was changed.'
    )
  const unlock = acquireDeployLock(paths.deployRoot)
  try {
    log(formatRecoveryState(paths))
    if (mode.mode === 'list' || mode.mode === 'interactive') {
      for (const release of listRecoveryReleases(paths)) {
        log(
          `${release.releaseId}; tag=${release.tag}; commit=${release.commitSha}; path=${release.releasePath}; ${release.error ? `REJECTED: ${release.error}` : 'runtime/manifest checked; database compatibility requires operator verification'}`
        )
      }
    }
    if (mode.mode === 'list') return 'listed'
    if (mode.mode === 'interactive' && !isTTY)
      throw new Error(
        'Interactive recovery requires a TTY. Use --list/--preview or explicitly bind --release and --confirm to the same release ID.'
      )
    const releaseId =
      mode.mode === 'interactive'
        ? (await ask('Choose managed release ID (empty cancels): '))?.trim()
        : mode.releaseId
    if (!releaseId) return 'cancelled'
    const selected = recoverySelectionSnapshot(paths, releaseId)
    log(
      `Selected ${selected.release.releaseId}; tag=${selected.release.tag}; commit=${selected.release.commitSha}; path=${selected.release.releasePath}`
    )
    log(
      'This starts only the selected release. Database is not restored; verify its compatibility before confirming.'
    )
    if (mode.mode === 'preview') return 'previewed'
    if (
      mode.mode === 'interactive' &&
      (await ask(
        `Type the full release ID ${releaseId} to confirm (empty cancels): `
      )) !== releaseId
    )
      return 'cancelled'
    const rechecked = recoverySelectionSnapshot(paths, releaseId)
    if (selected.fingerprint !== rechecked.fingerprint)
      throw new Error(
        'Selected release or deployment state changed during confirmation; no release was started.'
      )
    const journal = readActivationJournal(paths)
    const allowedReleaseDirs = [
      getCurrentDeployRelease(paths),
      getPreviousDeployRelease(paths),
      selected.release.releasePath
    ]
    if (journal)
      allowedReleaseDirs.push(
        inspectRecoveryRelease(paths, journal.candidate.split('/').at(-1)!)
          .releasePath
      )
    prepare()
    await activate({
      paths,
      candidateRelease: selected.release.releasePath,
      explicitRecovery: true,
      verifyReadiness: (releasePath) =>
        restartAndVerifyProduction({
          standaloneDir: releasePath,
          allowedReleaseDirs
        })
    })
    log(
      'Explicit recovery passed three-instance and HTTP readiness. Database was not restored.'
    )
    return 'recovered'
  } finally {
    unlock()
  }
}
