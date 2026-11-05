import { describe, expect, it } from 'vitest'
import {
  MERGE_DETAIL_KEYS,
  assessMergeOptions,
  attributeHits,
  candidateCounts,
  buildCandidates,
  mergeFacts,
  mergeSignals,
  normalizeMergeName,
  parseSizeMb,
  rankMergeOptions,
  signalHits,
  sizesClose,
  toMergeDetail,
  type MergeRankEntry,
  type MergeRecordFact,
  type MirrorCard,
  type MirrorLink
} from '~/lib/officialMirror/decide'
import {
  MERGE_SIGNALS,
  type MergeSignal,
  type MergeSignalCheck
} from '~/types/api/officialMirror'

const at = (value: string) => new Date(value)

const link = (overrides: Partial<MirrorLink> = {}): MirrorLink => ({
  id: 1,
  resourceId: 1,
  storage: 'user',
  content: 'https://example.test/a',
  size: '',
  code: '',
  password: '',
  fileHash: '',
  version: 1,
  sortOrder: 0,
  attachedAt: at('2026-01-01T00:00:00.000Z'),
  contentChangedAt: null,
  ...overrides
})

const card = (overrides: Partial<MirrorCard> = {}): MirrorCard => {
  const id = overrides.id ?? 1
  return {
    id,
    patchId: 10,
    patchUniqueId: 'abcd1234',
    patchName: '游戏',
    patchStatus: 0,
    section: 'galgame',
    name: '卡片',
    note: '',
    type: ['pc'],
    language: ['ja-jp'],
    platform: ['windows'],
    status: 0,
    download: 0,
    userId: 2,
    publisherName: '用户',
    role: 1,
    publisherLeftAt: null,
    created: at('2026-01-01T00:00:00.000Z'),
    updated: at('2026-01-02T00:00:00.000Z'),
    links: [link({ id: id * 100, resourceId: id })],
    ...overrides
  }
}

const staffCard = (overrides: Partial<MirrorCard> = {}): MirrorCard => {
  const id = overrides.id ?? 2
  return card({
    role: 3,
    userId: 8,
    created: at('2026-03-01T00:00:00.000Z'),
    links: [link({ id: id * 100, resourceId: id, storage: 'touchgal' })],
    ...overrides,
    id
  })
}

const record = (overrides: Partial<MergeRecordFact> = {}): MergeRecordFact => ({
  userResourceId: 1,
  staffResourceId: 2,
  status: 'dismissed',
  patchId: 10,
  section: 'galgame',
  detail: null,
  handledAt: at('2026-04-01T00:00:00.000Z'),
  handledByUserId: 7,
  ...overrides
})

const hitSet = (signals: MergeSignalCheck[]) =>
  signals.filter((item) => item.hit).map((item) => item.signal)

/** Signals with the listed hits; the rest miss. */
const signals = (hits: MergeSignal[]): MergeSignalCheck[] =>
  MERGE_SIGNALS.map((signal) => ({
    signal,
    hit: hits.includes(signal),
    user: [],
    staff: []
  }))

const entry = (
  staffId: number,
  hits: MergeSignal[],
  overrides: Partial<MergeRankEntry> = {}
): MergeRankEntry => ({
  staffId,
  sameSection: true,
  mergeable: true,
  signals: signals(hits),
  ...overrides
})

describe('merge size and name parsing', () => {
  it('parses sizes with an optional space and unit, case-insensitively, in MB', () => {
    expect(parseSizeMb('1.5 GB')).toBe(1536)
    expect(parseSizeMb('700MB')).toBe(700)
    expect(parseSizeMb('512 kb')).toBe(0.5)
    expect(parseSizeMb('2tB')).toBe(2 * 1024 * 1024)
    expect(parseSizeMb('  3 gb ')).toBe(3072)
  })

  it('treats other shapes and zero as unparseable', () => {
    for (const value of [
      '',
      'abc',
      '1.5GiB',
      '1,5 GB',
      '1  GB',
      '1.5 G',
      'GB',
      '0 MB',
      '-1 MB',
      '1e3 MB'
    ]) {
      expect(parseSizeMb(value)).toBeNull()
    }
  })

  it('compares sizes against the larger value with the tolerance inclusive', () => {
    expect(sizesClose(100, 97)).toBe(true)
    expect(sizesClose(97, 100)).toBe(true)
    expect(sizesClose(1, 0.97)).toBe(true)
    expect(sizesClose(100, 96.9)).toBe(false)
  })

  it('normalises full width, case, whitespace and ASCII or CJK punctuation', () => {
    expect(normalizeMergeName('ＡＢＣ　１２３')).toBe('abc123')
    expect(normalizeMergeName('【汉化】 Game: Title! v1.0')).toBe(
      '汉化gametitlev10'
    )
    expect(normalizeMergeName('「本体」、追加・パッチ。～+|')).toBe(
      '本体追加パッチ'
    )
    expect(normalizeMergeName(' ！？ ')).toBe('')
  })
})

describe('merge signals', () => {
  const counts = (users: [number, number][], staff: [number, number][]) => ({
    users: new Map(users),
    staff: new Map(staff)
  })

  it('ignores order and duplicates for type, language and platform', () => {
    const user = card({
      type: ['pc', 'patch'],
      language: ['zh-cn', 'zh-cn'],
      platform: ['windows']
    })
    const staff = staffCard({
      type: ['patch', 'pc'],
      language: ['zh-cn'],
      platform: ['android']
    })
    const result = mergeSignals(user, staff, counts([], []))
    expect(result.map((item) => item.signal)).toEqual([...MERGE_SIGNALS])
    expect(hitSet(result)).toEqual(expect.arrayContaining(['type', 'language']))
    expect(hitSet(result)).not.toContain('platform')
    expect(result[0]).toMatchObject({
      user: ['pc', 'patch'],
      staff: ['patch', 'pc']
    })
  })

  it('matches size from user external links only against any staff link', () => {
    const user = card({
      links: [
        link({ id: 1, storage: 'touchgal', size: '2 GB' }),
        link({ id: 2, storage: 'user', size: '1.00 GB' })
      ]
    })
    const near = staffCard({
      links: [
        link({ id: 3, resourceId: 2, storage: 'touchgal', size: '1010 MB' })
      ]
    })
    const backupOnly = staffCard({
      links: [link({ id: 3, resourceId: 2, storage: 'touchgal', size: '2 GB' })]
    })
    const unparsed = staffCard({
      links: [
        link({ id: 3, resourceId: 2, storage: 'touchgal', size: '约 1 GB' })
      ]
    })
    const none = counts([], [])
    const sizeOf = (staff: MirrorCard) =>
      mergeSignals(user, staff, none).find((item) => item.signal === 'size')
    expect(sizeOf(near)).toMatchObject({
      hit: true,
      user: ['1.00 GB'],
      staff: ['1010 MB']
    })
    expect(sizeOf(backupOnly)?.hit).toBe(false)
    expect(sizeOf(unparsed)?.hit).toBe(false)
  })

  it('hits name on containment after normalisation, never on an empty side', () => {
    const none = counts([], [])
    const nameOf = (userName: string, staffName: string) =>
      mergeSignals(
        card({ name: userName }),
        staffCard({ name: staffName }),
        none
      ).find((item) => item.signal === 'name')?.hit
    expect(nameOf('ＧＡＭＥ 本体', '【站方】game本体（中文）')).toBe(true)
    expect(nameOf('game 本体 v2', 'game本体')).toBe(true)
    expect(nameOf('本体', '追加内容')).toBe(false)
    expect(nameOf('！！', 'game')).toBe(false)
  })

  it('reports later and unique with raw display values', () => {
    const user = card({ id: 1 })
    const staff = staffCard({ id: 2 })
    const result = mergeSignals(user, staff, counts([[1, 1]], [[2, 1]]))
    expect(result.find((item) => item.signal === 'later')).toMatchObject({
      hit: true,
      user: ['2026-01-01T00:00:00.000Z'],
      staff: ['2026-03-01T00:00:00.000Z']
    })
    expect(result.find((item) => item.signal === 'unique')).toMatchObject({
      hit: true,
      user: ['1'],
      staff: ['1']
    })
    const shared = mergeSignals(user, staff, counts([[1, 2]], [[2, 1]]))
    expect(shared.find((item) => item.signal === 'unique')).toMatchObject({
      hit: false,
      user: ['2'],
      staff: ['1']
    })
    const earlier = mergeSignals(
      user,
      staffCard({ created: at('2025-12-01T00:00:00.000Z') }),
      counts([], [])
    )
    expect(earlier.find((item) => item.signal === 'later')?.hit).toBe(false)
    expect(signalHits(result)).toBe(hitSet(result).length)
    expect(attributeHits(result)).toBe(3)
  })

  it('does not count dismissed pairs toward unique', () => {
    const user = card({ id: 1 })
    const first = staffCard({ id: 2 })
    const second = staffCard({ id: 3 })
    const pairs = buildCandidates(
      [user, first, second],
      [record({ staffResourceId: 3 })]
    )
    const counted = candidateCounts(pairs)
    expect(counted.users.get(1)).toBe(1)
    expect(counted.staff.get(3)).toBeUndefined()
  })
})

describe('rankMergeOptions', () => {
  it('returns none without a mergeable option and keeps every option ordered', () => {
    const result = rankMergeOptions([
      entry(5, ['type'], { mergeable: false }),
      entry(3, ['type', 'language'], { mergeable: false, sameSection: false })
    ])
    expect(result.state).toBe('none')
    expect(result.recommendedStaffId).toBeNull()
    expect(result.ordered.map((item) => item.staffId)).toEqual([5, 3])
  })

  it('recommends a single option with two attribute hits, otherwise insufficient', () => {
    expect(rankMergeOptions([entry(4, ['type', 'platform'])])).toMatchObject({
      state: 'recommended',
      recommendedStaffId: 4
    })
    expect(
      rankMergeOptions([entry(4, ['type', 'size', 'name', 'later', 'unique'])])
    ).toMatchObject({ state: 'insufficient', recommendedStaffId: null })
  })

  it('needs a lead of two hits and two attribute hits among several options', () => {
    expect(
      rankMergeOptions([
        entry(2, ['type', 'language', 'platform', 'name']),
        entry(3, ['type', 'language'])
      ])
    ).toMatchObject({ state: 'recommended', recommendedStaffId: 2 })
    expect(
      rankMergeOptions([
        entry(2, ['type', 'language', 'platform']),
        entry(3, ['type', 'language'])
      ])
    ).toMatchObject({ state: 'close', recommendedStaffId: null })
    expect(
      rankMergeOptions([
        entry(2, ['type', 'size', 'name', 'later']),
        entry(3, ['later'])
      ])
    ).toMatchObject({ state: 'insufficient', recommendedStaffId: null })
  })

  it('never recommends a tie at the top', () => {
    const tied = rankMergeOptions([
      entry(7, ['type', 'language', 'platform']),
      entry(6, ['type', 'language', 'platform'])
    ])
    expect(tied).toMatchObject({ state: 'close', recommendedStaffId: null })
    expect(tied.ordered.map((item) => item.staffId)).toEqual([6, 7])
  })

  it('uses only mergeable same-section options for the recommendation', () => {
    const result = rankMergeOptions([
      entry(2, ['type', 'language']),
      entry(3, ['type', 'language', 'platform', 'size', 'name'], {
        mergeable: false
      }),
      entry(4, ['type', 'language', 'platform', 'size', 'name'], {
        sameSection: false,
        mergeable: false
      })
    ])
    expect(result).toMatchObject({
      state: 'recommended',
      recommendedStaffId: 2
    })
  })

  it('orders recommended, other mergeable, other same-section, then the other section', () => {
    const result = rankMergeOptions([
      entry(9, ['type'], { sameSection: false, mergeable: false }),
      entry(8, ['type', 'language', 'platform', 'size'], {
        sameSection: false,
        mergeable: false
      }),
      entry(7, ['type', 'language', 'platform', 'size', 'name', 'later'], {
        mergeable: false
      }),
      entry(6, ['type'], { mergeable: false }),
      entry(5, ['type', 'language']),
      entry(4, ['type']),
      entry(3, ['type', 'language', 'platform', 'size', 'name']),
      entry(2, ['type'])
    ])
    expect(result).toMatchObject({
      state: 'recommended',
      recommendedStaffId: 3
    })
    expect(result.ordered.map((item) => item.staffId)).toEqual([
      3, 5, 2, 4, 7, 6, 8, 9
    ])
  })
})

describe('assessMergeOptions', () => {
  it('lists other-section staff cards as section_mismatch and never mergeable', () => {
    const user = card({ id: 1 })
    const same = staffCard({ id: 2 })
    const other = staffCard({ id: 3, section: 'patch' })
    const facts = mergeFacts([user, same, other], [])
    const result = assessMergeOptions({
      user,
      staffCards: [other, same],
      facts,
      openCaseIds: () => []
    })
    expect(result).toMatchObject({
      eligible: true,
      state: 'recommended',
      recommendedStaffId: 2
    })
    expect(result.options.map((item) => item.staffId)).toEqual([2, 3])
    expect(result.options[0]).toMatchObject({
      highConfidence: true,
      mergeable: true,
      dismissable: true
    })
    expect(result.options[1]).toMatchObject({
      sameSection: false,
      mergeable: false,
      dismissable: false,
      blocks: [
        {
          code: 'section_mismatch',
          message: '与用户资源不在同一分区，不能合并'
        }
      ]
    })
  })

  it('keeps a blocked pair dismissable and a dismissed pair reopenable only', () => {
    const user = card({ id: 1 })
    const blocked = staffCard({ id: 2 })
    const dismissed = staffCard({ id: 3 })
    const facts = mergeFacts(
      [user, blocked, dismissed],
      [record({ userResourceId: 1, staffResourceId: 3 })]
    )
    const result = assessMergeOptions({
      user,
      staffCards: [blocked, dismissed],
      facts,
      openCaseIds: (id) => (id === 2 ? [41] : [])
    })
    const byId = new Map(result.options.map((item) => [item.staffId, item]))
    expect(result.state).toBe('none')
    expect(byId.get(2)).toMatchObject({
      mergeable: false,
      dismissable: true,
      record: null
    })
    expect(byId.get(2)?.blocks.map((item) => item.code)).toEqual([
      'staff_case_open'
    ])
    expect(byId.get(3)).toMatchObject({ mergeable: false, dismissable: false })
    expect(byId.get(3)?.record?.status).toBe('dismissed')
    expect(byId.get(3)?.blocks.map((item) => item.code)).toContain(
      'pair_dismissed'
    )
  })

  it('marks a survivor or handed-over user card ineligible with nothing to dismiss', () => {
    const staff = staffCard({ id: 2 })
    const survivor = card({ id: 1 })
    const survivorFacts = mergeFacts(
      [survivor, staff],
      [record({ status: 'merged', staffResourceId: 99 })]
    )
    const merged = assessMergeOptions({
      user: survivor,
      staffCards: [staff],
      facts: survivorFacts,
      openCaseIds: () => []
    })
    expect(merged).toMatchObject({ eligible: false, state: 'none' })
    expect(merged.options[0]).toMatchObject({
      mergeable: false,
      dismissable: false
    })
    const handed = card({
      id: 1,
      publisherLeftAt: at('2026-02-01T00:00:00.000Z')
    })
    const left = assessMergeOptions({
      user: handed,
      staffCards: [staff],
      facts: mergeFacts([handed, staff], []),
      openCaseIds: () => []
    })
    expect(left).toMatchObject({ eligible: false, state: 'none' })
    expect(left.options[0]?.blocks.map((item) => item.code)).toContain(
      'user_handed_over'
    )
  })

  it('does not offer a staff survivor and skips the user card itself', () => {
    const user = card({ id: 1 })
    const survivorStaff = staffCard({ id: 2 })
    const facts = mergeFacts(
      [user, survivorStaff],
      [record({ userResourceId: 2, staffResourceId: 50, status: 'merged' })]
    )
    const result = assessMergeOptions({
      user,
      staffCards: [user, survivorStaff],
      facts,
      openCaseIds: () => []
    })
    expect(result.options.map((item) => item.staffId)).toEqual([2])
    expect(result.options[0]).toMatchObject({
      mergeable: false,
      dismissable: false
    })
    expect(result.options[0]?.blocks.map((item) => item.code)).toContain(
      'survivor_chain'
    )
  })
})

/** Small deterministic generator so failures replay. */
const generator = (seed: number) => {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  const pick = <T>(values: readonly T[]) =>
    values[Math.floor(next() * values.length)]
  const chance = (probability: number) => next() < probability
  return { pick, chance }
}

describe('high-confidence pairs are always the recommendation', () => {
  it('recommends every mergeable high pair across generated games', () => {
    let highChecked = 0
    let recommendedSeen = 0
    for (let seed = 1; seed <= 3000; seed += 1) {
      const random = generator(seed)
      const types = [['pc'], ['patch'], ['pc', 'patch']]
      const languages = [['ja-jp'], ['zh-cn'], ['zh-cn', 'ja-jp']]
      const platforms = [['windows'], ['android']]
      const sizes = ['1 GB', '1.01 GB', '700 MB', '2 GB', '', '未知']
      const names = ['本体', '本体 中文', '追加内容', 'Game 本体']
      const sections = ['galgame', 'galgame', 'galgame', 'patch']
      // Most cards share the game's attributes so high pairs are common.
      const base = {
        type: random.pick(types),
        language: random.pick(languages),
        platform: random.pick(platforms)
      }
      const attribute = <K extends keyof typeof base>(
        key: K,
        pool: (typeof base)[K][]
      ) => (random.chance(0.8) ? base[key] : random.pick(pool))
      const cards: MirrorCard[] = []
      const userCount = random.pick([1, 1, 2, 3])
      for (let index = 0; index < userCount; index += 1) {
        const id = index + 1
        cards.push(
          card({
            id,
            section: random.pick(sections),
            name: random.pick(names),
            type: attribute('type', types),
            language: attribute('language', languages),
            platform: attribute('platform', platforms),
            status: random.chance(0.1) ? 1 : 0,
            publisherLeftAt: random.chance(0.1)
              ? at('2026-02-01T00:00:00.000Z')
              : null,
            created: at(
              random.pick([
                '2026-01-01T00:00:00.000Z',
                '2026-04-01T00:00:00.000Z'
              ])
            ),
            links: [
              link({
                id: id * 100,
                resourceId: id,
                storage: 'user',
                size: random.pick(sizes)
              }),
              ...(random.chance(0.3)
                ? [
                    link({
                      id: id * 100 + 1,
                      resourceId: id,
                      storage: 'touchgal',
                      size: random.pick(sizes)
                    })
                  ]
                : [])
            ]
          })
        )
      }
      const staffTotal = random.pick([1, 1, 2, 3, 4])
      for (let index = 0; index < staffTotal; index += 1) {
        const id = 11 + index
        cards.push(
          staffCard({
            id,
            section: random.pick(sections),
            name: random.pick(names),
            type: attribute('type', types),
            language: attribute('language', languages),
            platform: attribute('platform', platforms),
            status: random.chance(0.15) ? 1 : 0,
            created: at(
              random.pick([
                '2025-12-01T00:00:00.000Z',
                '2026-03-01T00:00:00.000Z'
              ])
            ),
            links: [
              link({
                id: id * 100,
                resourceId: id,
                storage: random.chance(0.1) ? 'user' : 'touchgal',
                size: random.pick(sizes)
              })
            ]
          })
        )
      }
      const records: MergeRecordFact[] = []
      for (const user of cards.filter((item) => item.role < 3)) {
        for (const staff of cards.filter((item) => item.role >= 3)) {
          if (random.chance(0.15)) {
            records.push(
              record({ userResourceId: user.id, staffResourceId: staff.id })
            )
          }
        }
        if (random.chance(0.05)) {
          records.push(
            record({
              userResourceId: user.id,
              staffResourceId: 99,
              status: 'merged'
            })
          )
        }
      }
      const open = new Set(
        cards
          .filter((item) => item.role >= 3 && random.chance(0.1))
          .map((item) => item.id)
      )
      const facts = mergeFacts(cards, records)
      for (const user of cards.filter((item) => item.role < 3)) {
        const result = assessMergeOptions({
          user,
          staffCards: cards.filter((item) => item.role >= 3),
          facts,
          openCaseIds: (id) => (open.has(id) ? [id] : [])
        })
        if (result.recommendedStaffId !== null) {
          recommendedSeen += 1
          expect(result.state).toBe('recommended')
          expect(result.options[0]?.staffId).toBe(result.recommendedStaffId)
          expect(result.options[0]?.mergeable).toBe(true)
        } else {
          expect(result.state).not.toBe('recommended')
        }
        for (const option of result.options) {
          if (!option.sameSection) expect(option.mergeable).toBe(false)
          if (!option.highConfidence || !option.mergeable) continue
          highChecked += 1
          expect({
            seed,
            user: user.id,
            staff: option.staffId,
            state: result.state
          }).toEqual({
            seed,
            user: user.id,
            staff: option.staffId,
            state: 'recommended'
          })
          expect(result.recommendedStaffId).toBe(option.staffId)
        }
      }
    }
    expect(highChecked).toBeGreaterThan(50)
    expect(recommendedSeen).toBeGreaterThan(highChecked)
  })
})

describe('merge detail keys', () => {
  const base = {
    movedLinkIds: [4, 5],
    noteAppended: true,
    contentConfirmed: true as const,
    basis: 'a'.repeat(64),
    sourceAuthorId: 8,
    likeCount: 2,
    userResourceId: 1,
    staffResourceId: 2
  }

  it('writes every known key including recommended', () => {
    const detail = toMergeDetail({ ...base, recommended: false })
    expect(Object.keys(detail).sort()).toEqual([...MERGE_DETAIL_KEYS].sort())
    expect(detail.recommended).toBe(false)
  })

  it('omits recommended when unknown so old details stay unchanged', () => {
    const detail = toMergeDetail(base)
    expect('recommended' in detail).toBe(false)
    expect(
      Object.keys(detail).every((key) =>
        (MERGE_DETAIL_KEYS as readonly string[]).includes(key)
      )
    ).toBe(true)
  })
})
