import type { VndbProducer } from '~/lib/arnebiae/vndb'
import {
  NEXTMOE_CATALOG_BATCH_MAX,
  type NextmoeCompanyList,
  type NextmoeWork,
  type NextmoeWorkList
} from '~/app/api/company/nextmoe/types'
import {
  hasConflictingCompanyExternalIds,
  nameVariantClusterKeys,
  nameVariantKeys,
  type NameVariantCompany
} from './nameVariantSuggestions'

export const SOURCE_PAIR_KIND = 'source-pair'
export const SOURCE_PAIR_VNDB_PAUSE_MS = 250
export const SOURCE_PAIR_VNDB_CONCURRENCY = 4
/**
 * Gap between serial catalog requests. Full-size batches stay under the
 * 60/minute limit without the old one-second pause.
 */
export const SOURCE_PAIR_NEXTMOE_PAUSE_MS = 200
/** One in-flight request, at the public batch-lane maximum of 100 keys. */
export const SOURCE_PAIR_NEXTMOE_BATCH = NEXTMOE_CATALOG_BATCH_MAX

const VNDB_DEVELOPER_TYPES = new Set(['co', 'ng', 'in'])
const FOLDED_KEY_MAX_LENGTH = 107

export type SourcePairHit = {
  companyId: number
  source: 'vndb' | 'nextmoe'
  field: 'name' | 'original' | 'alias' | 'display_name'
  value: string
}

export type SourcePairEvidence = {
  kind: typeof SOURCE_PAIR_KIND
  patchId: number
  upstreamIds: string[]
  bag: string[]
  hits: SourcePairHit[]
}

export type SourcePairSuggestion = {
  kind: typeof SOURCE_PAIR_KIND
  targetCompanyId: number
  sourceCompanyIds: number[]
  foldedKey: string
  names: string[]
  evidence: SourcePairEvidence
}

export type SourcePairPatch = {
  id: number
  vndbId: string | null
  bangumiId: number | null
  companyIds: number[]
}

export type SourcePairOptions = {
  loadVndbDevelopers?: (vndbId: string) => Promise<VndbProducer[]>
  listNextmoeWorksByRefs?: (refs: string[]) => Promise<NextmoeWorkList>
  listNextmoeCompaniesByIds?: (ids: string[]) => Promise<NextmoeCompanyList>
  isNextmoeConfigured?: () => boolean
  sleep?: (ms: number) => Promise<void>
  vndbPauseMs?: number
  vndbConcurrency?: number
  nextmoePauseMs?: number
  onProgress?: (event: SourcePairProgress) => void
}

export type SourcePairProgress = {
  phase: 'nextmoe' | 'vndb'
  current: number
  total: number
  detail?: string
}

type EvidenceField = {
  source: 'vndb' | 'nextmoe'
  field: 'name' | 'original' | 'alias' | 'display_name'
  value: string
}

type NameBag = {
  upstreamIds: string[]
  strings: string[]
  keys: Set<string>
  entries: EvidenceField[]
}

const uniqueStrings = (values: Array<string | null | undefined>) => [
  ...new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
  )
]

const clusterIdKey = (ids: number[]) =>
  [...ids].sort((left, right) => left - right).join(',')

const chunk = <T>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size)
  )

const patchRefs = (patch: SourcePairPatch): string[] => {
  const refs: string[] = []
  const vndbId = patch.vndbId?.trim()
  if (vndbId) refs.push(`vndb:${vndbId.toLowerCase()}`)
  if (patch.bangumiId !== null && patch.bangumiId !== undefined) {
    refs.push(`bangumi:${patch.bangumiId}`)
  }
  return refs
}

const workRefKeys = (work: NextmoeWork): string[] =>
  (work.refs ?? []).map(
    (ref) =>
      `${ref.source.trim().toLowerCase()}:${ref.external_id.trim().toLowerCase()}`
  )

const bagFromEntries = (
  upstreamIds: string[],
  entries: EvidenceField[]
): NameBag | null => {
  const uniqueEntries = entries.filter(
    (entry, index) =>
      entry.value.trim().length > 0 &&
      entries.findIndex(
        (other) =>
          other.source === entry.source &&
          other.field === entry.field &&
          other.value === entry.value
      ) === index
  )
  const strings = uniqueStrings(uniqueEntries.map((entry) => entry.value))
  if (strings.length === 0 || upstreamIds.length === 0) return null
  return {
    upstreamIds,
    strings,
    keys: new Set(strings.flatMap((value) => nameVariantKeys(value))),
    entries: uniqueEntries.map((entry) => ({
      ...entry,
      value: entry.value.trim()
    }))
  }
}

const isAllowedVndbDeveloper = (developer: VndbProducer) =>
  !developer.type || VNDB_DEVELOPER_TYPES.has(developer.type)

const trimmedField = (
  source: EvidenceField['source'],
  field: EvidenceField['field'],
  value: string | null | undefined
): EvidenceField | null => {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return { source, field, value: trimmed }
}

const vndbBag = (developer: VndbProducer): NameBag | null => {
  if (!isAllowedVndbDeveloper(developer)) return null
  const producerId = developer.id?.trim()
  if (!producerId) return null
  return bagFromEntries(
    [`vndb:${producerId.toLowerCase()}`],
    [
      trimmedField('vndb', 'name', developer.name),
      trimmedField('vndb', 'original', developer.original),
      ...(developer.aliases ?? []).map((alias) =>
        trimmedField('vndb', 'alias', alias)
      )
    ].flatMap((entry) => (entry ? [entry] : []))
  )
}

const nextmoeBag = (
  upstreamId: string,
  company: { display_name: string }
): NameBag | null => {
  const displayName = trimmedField(
    'nextmoe',
    'display_name',
    company.display_name
  )
  if (!displayName) return null
  return bagFromEntries([upstreamId], [displayName])
}

const keysIntersect = (left: string[], right: Set<string>) =>
  left.some((key) => right.has(key))

const foldedKeyFor = (upstreamIds: string[], memberIds: number[]) =>
  (upstreamIds[0] ?? clusterIdKey(memberIds)).slice(0, FOLDED_KEY_MAX_LENGTH)

const hitsForMembers = (
  members: NameVariantCompany[],
  entries: EvidenceField[]
): SourcePairHit[] => {
  const hits: SourcePairHit[] = []
  const seen = new Set<string>()
  for (const member of [...members].sort((left, right) => left.id - right.id)) {
    const companyKeys = new Set(nameVariantClusterKeys(member))
    for (const entry of entries) {
      const matched = nameVariantKeys(entry.value).some((key) =>
        companyKeys.has(key)
      )
      if (!matched) continue
      const identity = `${member.id}|${entry.source}|${entry.field}|${entry.value}`
      if (seen.has(identity)) continue
      seen.add(identity)
      hits.push({
        companyId: member.id,
        source: entry.source,
        field: entry.field,
        value: entry.value
      })
    }
  }
  return hits
}

const suggestionFromMembers = (
  members: NameVariantCompany[],
  bag: NameBag,
  patchId: number
): SourcePairSuggestion | null => {
  if (members.length < 2) return null
  if (hasConflictingCompanyExternalIds(members)) return null
  const ordered = [...members].sort((left, right) => left.id - right.id)
  const [target, ...sources] = ordered
  return {
    kind: SOURCE_PAIR_KIND,
    targetCompanyId: target.id,
    sourceCompanyIds: sources.map((company) => company.id),
    foldedKey: foldedKeyFor(
      bag.upstreamIds,
      ordered.map((company) => company.id)
    ),
    names: ordered.map((company) => company.name),
    evidence: {
      kind: SOURCE_PAIR_KIND,
      patchId,
      upstreamIds: bag.upstreamIds,
      bag: bag.strings,
      hits: hitsForMembers(ordered, bag.entries)
    }
  }
}

const fetchBatched = async <T>(
  keys: string[],
  fetchBatch: (keys: string[]) => Promise<{ items: T[] }>,
  sleep: (ms: number) => Promise<void>,
  pauseMs: number,
  batchSize = NEXTMOE_CATALOG_BATCH_MAX,
  onProgress?: (event: SourcePairProgress) => void
): Promise<T[]> => {
  if (keys.length === 0) return []
  const items: T[] = []
  const batches = chunk(keys, batchSize)
  onProgress?.({
    phase: 'nextmoe',
    current: 0,
    total: batches.length,
    detail: `共 ${keys.length} 个引用，每批 ${batchSize} 个`
  })
  for (const [index, batch] of batches.entries()) {
    if (index > 0) await sleep(pauseMs)
    try {
      const page = await fetchBatch(batch)
      items.push(...page.items)
      // eslint-disable-next-line no-console
      console.info(
        `[company-merges:detect] nextmoe batch ${index + 1}/${batches.length} keys=${batch.length} items=${page.items.length}`
      )
      onProgress?.({
        phase: 'nextmoe',
        current: index + 1,
        total: batches.length,
        detail: `本批 ${batch.length} 个引用，返回 ${page.items.length} 条`
      })
    } catch {
      // eslint-disable-next-line no-console
      console.info(
        `[company-merges:detect] nextmoe batch ${index + 1}/${batches.length} keys=${batch.length} skipped after retries`
      )
      onProgress?.({
        phase: 'nextmoe',
        current: index + 1,
        total: batches.length,
        detail: `本批 ${batch.length} 个引用未返回，已跳过`
      })
    }
  }
  return items
}

const loadNextmoeBagsByPatch = async (
  patches: SourcePairPatch[],
  options: SourcePairOptions,
  sleep: (ms: number) => Promise<void>
): Promise<Map<number, NameBag[]>> => {
  const bagsByPatch = new Map<number, NameBag[]>()
  const configured = options.isNextmoeConfigured?.() ?? false
  const listWorks = options.listNextmoeWorksByRefs
  if (!configured || !listWorks) {
    options.onProgress?.({
      phase: 'nextmoe',
      current: 0,
      total: 0,
      detail: '未配置，已跳过'
    })
    return bagsByPatch
  }

  const refs = uniqueStrings(patches.flatMap(patchRefs))
  const batchSize = SOURCE_PAIR_NEXTMOE_BATCH
  // eslint-disable-next-line no-console
  console.info(
    `[company-merges:detect] nextmoe refs=${refs.length} batch=${batchSize} works-only`
  )
  const works = await fetchBatched(
    refs,
    listWorks,
    sleep,
    options.nextmoePauseMs ?? SOURCE_PAIR_NEXTMOE_PAUSE_MS,
    batchSize,
    options.onProgress
  )

  for (const patch of patches) {
    const refSet = new Set(patchRefs(patch))
    if (refSet.size === 0) continue
    const bags: NameBag[] = []
    const seenUpstream = new Set<string>()
    for (const work of works) {
      if (!workRefKeys(work).some((ref) => refSet.has(ref))) continue
      for (const workCompany of work.companies ?? []) {
        const catalogId = workCompany.id.trim()
        if (!catalogId || seenUpstream.has(catalogId)) continue
        seenUpstream.add(catalogId)
        const bag = nextmoeBag(catalogId, workCompany)
        if (bag) bags.push(bag)
      }
    }
    if (bags.length > 0) bagsByPatch.set(patch.id, bags)
  }

  return bagsByPatch
}

const loadVndbBagsByPatch = async (
  patches: SourcePairPatch[],
  options: SourcePairOptions
): Promise<Map<number, NameBag[]>> => {
  const vndbBagsByPatch = new Map<number, NameBag[]>()
  const vndbPatches = patches.filter((patch) => patch.vndbId?.trim())
  const loadVndb = options.loadVndbDevelopers
  if (!loadVndb || vndbPatches.length === 0) return vndbBagsByPatch

  const concurrency = Math.max(
    1,
    options.vndbConcurrency ?? SOURCE_PAIR_VNDB_CONCURRENCY
  )
  let vndbDone = 0
  let cursor = 0
  options.onProgress?.({
    phase: 'vndb',
    current: 0,
    total: vndbPatches.length,
    detail: `共 ${vndbPatches.length} 部`
  })
  const runVndbWorker = async () => {
    while (loadVndb) {
      const index = cursor
      cursor += 1
      const patch = vndbPatches[index]
      if (!patch) return
      const vndbId = patch.vndbId?.trim()
      if (!vndbId) {
        vndbDone += 1
        options.onProgress?.({
          phase: 'vndb',
          current: vndbDone,
          total: vndbPatches.length
        })
        continue
      }
      try {
        const developers = await loadVndb(vndbId)
        const bags = developers.flatMap((developer) => {
          const bag = vndbBag(developer)
          return bag ? [bag] : []
        })
        if (bags.length > 0) vndbBagsByPatch.set(patch.id, bags)
      } catch {
        // Missing key / 429 / 5xx: skip this patch's VNDB bags.
      }
      vndbDone += 1
      options.onProgress?.({
        phase: 'vndb',
        current: vndbDone,
        total: vndbPatches.length
      })
      if (vndbDone === vndbPatches.length || vndbDone % 20 === 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[company-merges:detect] vndb ${vndbDone}/${vndbPatches.length}`
        )
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, vndbPatches.length) }, () =>
      runVndbWorker()
    )
  )
  return vndbBagsByPatch
}

/**
 * Same-patch source-pair suggestions: local companies on one work that land in
 * the same upstream name bag (VNDB producer or NextMoe company). Different
 * bags on the same patch stay apart. Fetch failures skip this layer.
 * NextMoe and VNDB run together; neither result depends on the other.
 */
export async function suggestSourcePairHits(
  companies: NameVariantCompany[],
  patches: SourcePairPatch[],
  options: SourcePairOptions = {}
): Promise<SourcePairSuggestion[]> {
  const eligible = patches.filter((patch) => {
    const uniqueIds = new Set(patch.companyIds)
    return uniqueIds.size >= 2 && patchRefs(patch).length > 0
  })
  if (eligible.length === 0) return []

  const sleep = options.sleep ?? (async () => {})
  const companyById = new Map(companies.map((company) => [company.id, company]))
  const keysByCompanyId = new Map(
    companies.map((company) => [company.id, nameVariantClusterKeys(company)])
  )
  // eslint-disable-next-line no-console
  console.info(
    `[company-merges:detect] source-pair patches=${eligible.length} nextmoe=${
      options.isNextmoeConfigured?.() ? 'on' : 'off'
    }`
  )

  const [nextmoeBagsByPatch, vndbBagsByPatch] = await Promise.all([
    loadNextmoeBagsByPatch(eligible, options, sleep),
    loadVndbBagsByPatch(eligible, options)
  ])
  // eslint-disable-next-line no-console
  console.info(
    `[company-merges:detect] nextmoe bags for ${nextmoeBagsByPatch.size} patches`
  )

  const byCluster = new Map<string, SourcePairSuggestion>()

  for (const patch of eligible) {
    const locals = [...new Set(patch.companyIds)].flatMap((companyId) => {
      const company = companyById.get(companyId)
      return company ? [company] : []
    })
    if (locals.length < 2) continue

    const bags: NameBag[] = [
      ...(vndbBagsByPatch.get(patch.id) ?? []),
      ...(nextmoeBagsByPatch.get(patch.id) ?? [])
    ]

    for (const bag of bags) {
      const matched = locals.filter((company) =>
        keysIntersect(keysByCompanyId.get(company.id) ?? [], bag.keys)
      )
      const suggestion = suggestionFromMembers(matched, bag, patch.id)
      if (!suggestion) continue
      const key = clusterIdKey([
        suggestion.targetCompanyId,
        ...suggestion.sourceCompanyIds
      ])
      const previous = byCluster.get(key)
      if (
        !previous ||
        suggestion.sourceCompanyIds.length > previous.sourceCompanyIds.length
      ) {
        byCluster.set(key, suggestion)
      }
    }
  }

  return [...byCluster.values()].sort(
    (left, right) => left.targetCompanyId - right.targetCompanyId
  )
}
