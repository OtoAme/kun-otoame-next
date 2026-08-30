import {
  beginCandidateActivation,
  completeCandidateActivation,
  getCurrentDeployRelease,
  getPreviousDeployRelease,
  pinPreviousToCurrent,
  recoverInterruptedActivation,
  rollbackDeploySlots,
  type DeploySlotPaths
} from './deploySlots'

export const activateReleaseWithReadiness = async ({
  paths,
  candidateRelease,
  preflightRelease = () => undefined,
  verifyReadiness
}: {
  paths: DeploySlotPaths
  candidateRelease: string
  preflightRelease?: (releasePath: string) => void
  verifyReadiness: (releasePath: string) => Promise<void>
}) => {
  const { oldCurrent } = beginCandidateActivation(paths, candidateRelease)
  try {
    preflightRelease(oldCurrent)
    preflightRelease(candidateRelease)
    await verifyReadiness(candidateRelease)
    completeCandidateActivation(paths)
  } catch (candidateError) {
    try {
      const restoredRelease = rollbackDeploySlots(paths)
      await verifyReadiness(restoredRelease)
    } catch (restoreError) {
      throw new AggregateError(
        [candidateError, restoreError],
        'Candidate deployment and automatic previous-release recovery both failed.'
      )
    }
    throw new Error(
      'Candidate deployment failed readiness; the previous release was restored and verified.',
      { cause: candidateError }
    )
  }
}

export const rollbackReleaseWithReadiness = async ({
  paths,
  preflightRelease = () => undefined,
  verifyReadiness
}: {
  paths: DeploySlotPaths
  preflightRelease?: (releasePath: string) => void
  verifyReadiness: (releasePath: string) => Promise<void>
}) => {
  const originalCurrent = getCurrentDeployRelease(paths)
  const rollbackTarget = getPreviousDeployRelease(paths)
  preflightRelease(originalCurrent)
  preflightRelease(rollbackTarget)
  beginCandidateActivation(paths, rollbackTarget)
  try {
    await verifyReadiness(rollbackTarget)
    pinPreviousToCurrent(paths)
    completeCandidateActivation(paths)
  } catch (rollbackError) {
    try {
      const originalCurrent = rollbackDeploySlots(paths)
      await verifyReadiness(originalCurrent)
    } catch (restoreError) {
      throw new AggregateError(
        [rollbackError, restoreError],
        'Previous-release rollback and original-release recovery both failed.'
      )
    }
    throw new Error(
      'Previous release failed readiness; the original release was restored and verified.',
      { cause: rollbackError }
    )
  }
}

export const recoverOrRollbackWithReadiness = async ({
  paths,
  preflightRelease = () => undefined,
  verifyReadiness
}: {
  paths: DeploySlotPaths
  preflightRelease?: (releasePath: string) => void
  verifyReadiness: (releasePath: string) => Promise<void>
}) => {
  const recovered = recoverInterruptedActivation(paths)
  if (recovered) {
    preflightRelease(recovered)
    await verifyReadiness(recovered)
    return 'recovered-interrupted' as const
  }

  await rollbackReleaseWithReadiness({
    paths,
    preflightRelease,
    verifyReadiness
  })
  return 'rolled-back' as const
}
