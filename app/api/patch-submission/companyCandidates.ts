import {
  createUnverifiedCompanyNameCandidates,
  readVerifiedCompanyCandidates
} from '~/app/api/company/identity/types'
import type {
  CompanyCandidateDiagnostic,
  CompanyCandidateSource,
  CompanyCandidateSourceState,
  TrustedCompanyCandidate
} from '~/app/api/company/identity/types'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

export interface PatchSubmissionCompanyCandidateInput {
  payload: PatchSubmissionPayload
  snapshots: unknown
}

export interface PatchSubmissionCompanyCandidates {
  candidates: TrustedCompanyCandidate[]
  snapshotDiagnostics: CompanyCandidateDiagnostic[]
  sourceStates: Record<CompanyCandidateSource, CompanyCandidateSourceState>
}

const validUrl = (value: string) => {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export const collectPatchSubmissionCompanyCandidates = (
  input: PatchSubmissionCompanyCandidateInput
): PatchSubmissionCompanyCandidates => {
  const verified = readVerifiedCompanyCandidates(input.snapshots, {
    vndb: input.payload.vndbId,
    bangumi: input.payload.bangumiId,
    steam: input.payload.steamId,
    dlsite: input.payload.dlsiteCode
  })
  const dlsiteCandidates = createUnverifiedCompanyNameCandidates(
    'dlsite',
    [input.payload.dlsiteCircleName],
    ['circle']
  ).map((trusted) => {
    const link = input.payload.dlsiteCircleLink.trim()
    const sourceWebsites = link && validUrl(link) ? [link] : []
    return {
      ...trusted,
      candidate: {
        ...trusted.candidate,
        entityType: 'amateur_group' as const,
        externalUrls: sourceWebsites,
        sourceWebsites
      }
    }
  })

  return {
    candidates: [
      ...verified.candidates,
      ...createUnverifiedCompanyNameCandidates(
        'vndb',
        input.payload.vndbDevelopers,
        ['developer']
      ),
      ...createUnverifiedCompanyNameCandidates(
        'bangumi',
        input.payload.bangumiDevelopers
      ),
      ...createUnverifiedCompanyNameCandidates(
        'steam',
        input.payload.steamDevelopers,
        ['developer']
      ),
      ...dlsiteCandidates
    ],
    snapshotDiagnostics: verified.diagnostics,
    sourceStates: verified.sourceStates
  }
}
