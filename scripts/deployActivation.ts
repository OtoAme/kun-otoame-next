import { DeploymentStartError, stopFailedRelease } from './deployPm2'
import { cleanupDeployReleases } from './deployReleaseCleanup'
import {
  beginCandidateActivation,
  completeCandidateActivation,
  recordActivationFailure,
  type DeploySlotPaths
} from './deploySlots'

export const activateReleaseWithReadiness = async ({
  paths,
  candidateRelease,
  preflightRelease = () => undefined,
  verifyReadiness,
  explicitRecovery = false,
  stopRelease = stopFailedRelease
}: {
  paths: DeploySlotPaths
  candidateRelease: string
  preflightRelease?: (releasePath: string) => void
  verifyReadiness: (releasePath: string) => Promise<void>
  explicitRecovery?: boolean
  stopRelease?: (releasePath: string) => Promise<void>
}) => {
  preflightRelease(candidateRelease)
  const activation = beginCandidateActivation(
    paths,
    candidateRelease,
    explicitRecovery
  )
  let ready = false
  try {
    await verifyReadiness(candidateRelease)
    ready = true
    completeCandidateActivation(paths, activation)
  } catch (originalError) {
    let error = originalError
    if (ready) {
      try {
        await stopRelease(candidateRelease)
        error = new DeploymentStartError(originalError)
      } catch (stopError) {
        error = new DeploymentStartError(originalError, stopError)
      }
    }
    try {
      recordActivationFailure(
        paths,
        error,
        error instanceof Error &&
          'stopConfirmed' in error &&
          error.stopConfirmed === true
      )
    } catch (recordError) {
      throw new AggregateError(
        [error, recordError],
        'Activation failed and failure recording failed; retain the unresolved journal and inspect manually.'
      )
    }
    throw error
  }

  if (explicitRecovery) return
  try {
    cleanupDeployReleases(paths)
  } catch (error) {
    console.warn(
      'Deployment is healthy, but historical release cleanup failed; retry with pnpm deploy:cleanup after inspection.',
      error
    )
  }
}
