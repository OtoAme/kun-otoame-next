import { suggestSuffixUniqueHits } from '~/app/api/company/identity/suffixSuggestions'
import { prisma } from '~/prisma/index'
import type {
  CompanyMergeDetectResponse,
  CompanyMergeDismissResponse,
  CompanyMergeSuggestionListResponse
} from '~/types/api/companyMerges'

const SUFFIX_UNIQUE_HIT_KIND = 'suffix-unique-hit'
const PENDING = 'pending'
const DISMISSED = 'dismissed'

export const listCompanyMergeSuggestions =
  async (): Promise<CompanyMergeSuggestionListResponse> => {
    const rows = await prisma.company_merge_suggestion.findMany({
      where: { status: PENDING },
      orderBy: [{ detected_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        kind: true,
        folded_key: true,
        target_company_id: true,
        source_company_ids: true,
        names: true,
        detected_at: true
      }
    })

    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: PENDING,
        foldedKey: row.folded_key,
        targetCompanyId: row.target_company_id,
        sourceCompanyIds: row.source_company_ids,
        names: row.names,
        detectedAt: row.detected_at.toISOString()
      }))
    }
  }

type ScannedCompany = {
  id: number
  name: string
  normalized_name: string | null
  alias: string[]
  name_identities: Array<{
    origin: string
    kind: string
    normalized_value: string
  }>
  external_ids: Array<{ source: string; external_id: string }>
}

/**
 * `suggestSuffixUniqueHits` takes one id per source, but the table allows a
 * company to hold several ids for the same source. Such a company has no
 * unambiguous external identity, so it is dropped from the scan instead of
 * being compared on a key we cannot trust. Returns `null` for that case.
 */
const toExternalIdRecord = (
  rows: ScannedCompany['external_ids']
): Record<string, string> | null => {
  const record: Record<string, string> = {}
  for (const row of rows) {
    const source = row.source.trim()
    const value = row.external_id.trim()
    if (!source || !value) continue
    const seen = record[source]
    if (seen === undefined) {
      record[source] = value
      continue
    }
    if (seen !== value) return null
  }
  return record
}

const loadClusterInput = async () => {
  const companies = await prisma.patch_company.findMany({
    select: {
      id: true,
      name: true,
      normalized_name: true,
      alias: true,
      name_identities: {
        select: { origin: true, kind: true, normalized_value: true }
      },
      external_ids: { select: { source: true, external_id: true } }
    }
  })

  return companies.flatMap((company) => {
    const externalIds = toExternalIdRecord(company.external_ids)
    if (externalIds === null) return []

    return [
      {
        id: company.id,
        name: company.name,
        normalizedName: company.normalized_name,
        alias: company.alias,
        identities: company.name_identities.map((identity) => ({
          origin: identity.origin,
          kind: identity.kind,
          normalizedValue: identity.normalized_value
        })),
        externalIds
      }
    ]
  })
}

/**
 * Read-only scan of `patch_company`, then an upsert of the resulting clusters
 * into the queue. Existing pending rows are refreshed in place; a key that was
 * dismissed is counted and left untouched, because this stage has no explicit
 * reopen action. No company is ever written.
 */
export const detectCompanyMergeSuggestions =
  async (): Promise<CompanyMergeDetectResponse> => {
    const suggestions = suggestSuffixUniqueHits(await loadClusterInput())
    if (suggestions.length === 0) {
      return { created: 0, updated: 0, skipped: 0 }
    }

    const existing = await prisma.company_merge_suggestion.findMany({
      where: {
        kind: SUFFIX_UNIQUE_HIT_KIND,
        status: { in: [PENDING, DISMISSED] }
      },
      select: { id: true, folded_key: true, status: true }
    })

    const pendingIdByKey = new Map<string, number>()
    const dismissedKeys = new Set<string>()
    for (const row of existing) {
      if (row.status === PENDING) {
        if (!pendingIdByKey.has(row.folded_key)) {
          pendingIdByKey.set(row.folded_key, row.id)
        }
        continue
      }
      dismissedKeys.add(row.folded_key)
    }

    const detectedAt = new Date()
    let created = 0
    let updated = 0
    let skipped = 0

    for (const suggestion of suggestions) {
      const cluster = {
        target_company_id: suggestion.targetCompanyId,
        source_company_ids: suggestion.sourceCompanyIds,
        names: suggestion.names,
        evidence: {
          kind: suggestion.kind,
          foldedKey: suggestion.foldedKey
        },
        detected_at: detectedAt
      }

      const pendingId = pendingIdByKey.get(suggestion.foldedKey)
      if (pendingId !== undefined) {
        await prisma.company_merge_suggestion.update({
          where: { id: pendingId },
          data: cluster
        })
        updated += 1
        continue
      }

      if (dismissedKeys.has(suggestion.foldedKey)) {
        skipped += 1
        continue
      }

      await prisma.company_merge_suggestion.create({
        data: {
          ...cluster,
          kind: suggestion.kind,
          status: PENDING,
          folded_key: suggestion.foldedKey
        }
      })
      created += 1
    }

    return { created, updated, skipped }
  }

/**
 * Dismiss one pending row and record who did it. The status guard lives in the
 * `updateMany` filter so two reviewers clicking at once cannot both win; the
 * follow-up read only runs to tell "already resolved" apart from "no such row".
 */
export const dismissCompanyMergeSuggestion = async (
  id: number,
  userId: number
): Promise<CompanyMergeDismissResponse | string> => {
  const result = await prisma.company_merge_suggestion.updateMany({
    where: { id, status: PENDING },
    data: {
      status: DISMISSED,
      resolved_at: new Date(),
      resolved_by_user_id: userId
    }
  })

  if (result.count > 0) {
    return { id }
  }

  const existing = await prisma.company_merge_suggestion.findUnique({
    where: { id },
    select: { id: true }
  })

  return existing ? '该建议已处理，无法重复驳回' : '未找到该会社合并建议'
}
