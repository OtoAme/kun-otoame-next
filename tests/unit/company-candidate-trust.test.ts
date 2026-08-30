import { describe, expect, it } from 'vitest'
import {
  COMPANY_CANDIDATE_MAX_ALIASES,
  COMPANY_CANDIDATE_MAX_PER_SOURCE,
  companyCandidateSnapshotSchema,
  createUnverifiedCompanyNameCandidates,
  readVerifiedCompanyCandidates
} from '~/app/api/company/identity/types'

const candidate = {
  source: 'vndb' as const,
  externalId: 'p1',
  name: 'ぱれっと',
  aliases: ['Palette'],
  roles: ['developer' as const],
  sourceRoles: ['developer'],
  entityType: 'company' as const,
  externalUrls: ['https://vndb.org/p1'],
  primaryLanguage: 'ja',
  sourceWebsites: ['https://example.test']
}

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  lookupId: 'v123',
  fetchedAt: '2026-08-30T08:00:00.000Z',
  candidates: [candidate],
  ...overrides
})

const lookupIds = {
  vndb: 'v123',
  bangumi: null,
  steam: null,
  dlsite: null
}

describe('trusted company candidate snapshots', () => {
  it('derives verified trust only when the source lookup id still matches', () => {
    const result = readVerifiedCompanyCandidates(
      { vndb: snapshot() },
      lookupIds
    )

    expect(result.candidates).toEqual([{ trust: 'verified', candidate }])
    expect(result.sourceStates.vndb).toBe('verified')
    expect(result.diagnostics).toEqual([])
  })

  it('invalidates a stale source slot and records the mismatch', () => {
    const result = readVerifiedCompanyCandidates(
      { vndb: snapshot() },
      { ...lookupIds, vndb: 'v456' }
    )

    expect(result.candidates).toEqual([])
    expect(result.sourceStates.vndb).toBe('stale')
    expect(result.diagnostics).toEqual([
      {
        source: 'vndb',
        reason: 'lookup-id-mismatch',
        lookupId: 'v123',
        expectedLookupId: 'v456'
      }
    ])
  })

  it('distinguishes a missing slot from a verified empty result', () => {
    const missing = readVerifiedCompanyCandidates(null, lookupIds)
    const empty = readVerifiedCompanyCandidates(
      { vndb: snapshot({ candidates: [] }) },
      lookupIds
    )

    expect(missing.sourceStates.vndb).toBe('missing')
    expect(empty.sourceStates.vndb).toBe('empty')
    expect(empty.diagnostics).toEqual([])
  })

  it('discards malformed JSON instead of trusting a partial candidate', () => {
    const result = readVerifiedCompanyCandidates(
      { vndb: snapshot({ candidates: [{ ...candidate, trust: 'verified' }] }) },
      lookupIds
    )

    expect(result.candidates).toEqual([])
    expect(result.sourceStates.vndb).toBe('invalid')
    expect(result.diagnostics).toEqual([
      { source: 'vndb', reason: 'invalid-snapshot' }
    ])
  })

  it('constructs client names as unverified without identity evidence', () => {
    expect(
      createUnverifiedCompanyNameCandidates('steam', [' Studio ', 'Studio'])
    ).toEqual([
      {
        trust: 'unverified',
        candidate: expect.objectContaining({
          source: 'steam',
          externalId: '',
          name: 'Studio',
          aliases: []
        })
      }
    ])
  })

  it('rejects candidate, alias and name values beyond their storage limits', () => {
    expect(
      companyCandidateSnapshotSchema.safeParse(
        snapshot({
          candidates: Array.from(
            { length: COMPANY_CANDIDATE_MAX_PER_SOURCE + 1 },
            () => candidate
          )
        })
      ).success
    ).toBe(false)
    expect(
      companyCandidateSnapshotSchema.safeParse(
        snapshot({
          candidates: [
            {
              ...candidate,
              aliases: Array.from(
                { length: COMPANY_CANDIDATE_MAX_ALIASES + 1 },
                (_, index) => `alias-${index}`
              )
            }
          ]
        })
      ).success
    ).toBe(false)
    expect(
      companyCandidateSnapshotSchema.safeParse(
        snapshot({ candidates: [{ ...candidate, name: 'x'.repeat(108) }] })
      ).success
    ).toBe(false)
  })
})
