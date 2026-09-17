import { describe, expect, it, vi } from 'vitest'

import type {
  NextmoeCompanyList,
  NextmoeWorkList
} from '~/app/api/company/nextmoe/client'
import {
  NEXTMOE_PROBE_SKIPPED_MESSAGE,
  isNextmoeProbeConfigured,
  runNextmoeCompanySampleProbe
} from '~/scripts/probeNextmoeCompanySample'

const work = (id: string, companyIds: string[]) => ({
  object: 'work',
  id,
  companies: companyIds.map((companyId) => ({
    object: 'company',
    id: companyId,
    display_name: `Company ${companyId}`
  }))
})

// The probe asks for its frozen work sample in one batch: the Koei refs first,
// then DUSK INDEX: GION and 耽美梦想2. Steam ids stay local and are never
// sent as a NextMoe ref.
const SAMPLE_WORK_REF_QUERY =
  'works:vndb:v2168,bangumi:21041,vndb:v49059,bangumi:473829,vndb:v3996,bangumi:60542'

const company = (id: string) => ({
  object: 'company',
  id,
  display_name: `Company ${id}`
})

const probeClient = (input: {
  works?: NextmoeWorkList
  producers?: NextmoeCompanyList
  companies?: NextmoeCompanyList
  calls?: string[]
}) => {
  const calls = input.calls ?? []
  return {
    listWorksByRefs: vi.fn(async (refs: string[]) => {
      calls.push(`works:${refs.join(',')}`)
      return input.works ?? { object: 'list' as const, items: [], missing: [] }
    }),
    listCompaniesByRefs: vi.fn(async (refs: string[]) => {
      calls.push(`producers:${refs.join(',')}`)
      return (
        input.producers ?? { object: 'list' as const, items: [], missing: [] }
      )
    }),
    listCompaniesByIds: vi.fn(async (ids: string[]) => {
      calls.push(`ids:${ids.join(',')}`)
      return (
        input.companies ?? { object: 'list' as const, items: [], missing: [] }
      )
    })
  }
}

describe('isNextmoeProbeConfigured', () => {
  it('treats a missing or blank key as unconfigured', () => {
    expect(isNextmoeProbeConfigured(undefined)).toBe(false)
    expect(isNextmoeProbeConfigured(null)).toBe(false)
    expect(isNextmoeProbeConfigured('')).toBe(false)
    expect(isNextmoeProbeConfigured('   ')).toBe(false)
    expect(isNextmoeProbeConfigured('nextmoe-key')).toBe(true)
  })
})

describe('runNextmoeCompanySampleProbe', () => {
  it('skips with a message and never calls the catalog when unconfigured', async () => {
    const client = probeClient({})
    const lines: string[] = []

    await runNextmoeCompanySampleProbe(
      isNextmoeProbeConfigured('') ? client : null,
      (line) => lines.push(line)
    )

    expect(lines).toEqual([NEXTMOE_PROBE_SKIPPED_MESSAGE])
    expect(client.listWorksByRefs).not.toHaveBeenCalled()
    expect(client.listCompaniesByRefs).not.toHaveBeenCalled()
    expect(client.listCompaniesByIds).not.toHaveBeenCalled()
  })

  it('prints the raw work, producer, and work-company payloads in order', async () => {
    const calls: string[] = []
    const client = probeClient({
      calls,
      works: {
        object: 'list',
        items: [work('w1', ['99', '7']), work('w2', ['99'])],
        missing: ['vndb:v404']
      },
      producers: {
        object: 'list',
        items: [company('p473')],
        missing: []
      },
      companies: {
        object: 'list',
        items: [
          {
            object: 'company',
            id: '99',
            display_name: 'KOEI Co., Ltd.',
            latin: 'KOEI',
            aliases: [
              { value: 'コーエー', lang: 'ja' },
              { value: '光栄', lang: 'ja', is_machine: true }
            ]
          }
        ],
        missing: ['7']
      }
    })
    const lines: string[] = []

    await runNextmoeCompanySampleProbe(client, (line) => lines.push(line))

    expect(calls).toEqual([
      SAMPLE_WORK_REF_QUERY,
      'producers:vndb:p473',
      'ids:99,7'
    ])
    expect(lines).toHaveLength(1)

    const payload = JSON.parse(lines[0])
    expect(Object.keys(payload)).toEqual([
      'works',
      'producerCompanies',
      'workCompanies'
    ])
    expect(payload.works).toEqual({
      object: 'list',
      items: [work('w1', ['99', '7']), work('w2', ['99'])],
      missing: ['vndb:v404']
    })
    expect(payload.producerCompanies.items).toEqual([company('p473')])
    // Machine aliases stay in the payload; filtering is the client's job.
    expect(payload.workCompanies.items[0].aliases).toEqual([
      { value: 'コーエー', lang: 'ja' },
      { value: '光栄', lang: 'ja', is_machine: true }
    ])
    expect(payload.workCompanies.missing).toEqual(['7'])
  })

  it('skips the id lookup when no work mentions a catalog company', async () => {
    const calls: string[] = []
    const client = probeClient({
      calls,
      works: { object: 'list', items: [work('w1', [])], missing: [] }
    })
    const lines: string[] = []

    await runNextmoeCompanySampleProbe(client, (line) => lines.push(line))

    expect(client.listCompaniesByIds).not.toHaveBeenCalled()
    expect(calls).toEqual([SAMPLE_WORK_REF_QUERY, 'producers:vndb:p473'])
    expect(JSON.parse(lines[0]).workCompanies).toBeNull()
  })

  it('caps the id lookup at one hundred unique catalog companies', async () => {
    const client = probeClient({
      works: {
        object: 'list',
        items: Array.from({ length: 120 }, (_, index) =>
          work(`w${index}`, [String(index), '0'])
        ),
        missing: []
      }
    })

    await runNextmoeCompanySampleProbe(client, () => undefined)

    const [ids] = client.listCompaniesByIds.mock.calls[0]
    expect(ids).toHaveLength(100)
    expect(new Set(ids).size).toBe(100)
  })
})
