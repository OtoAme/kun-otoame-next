import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  NEXTMOE_COMPANY_VALUE_MAX_LENGTH,
  createNextmoeCatalogClient,
  isNextmoeCatalogConfigured,
  nextmoeAliasValues
} from '~/app/api/company/nextmoe/client'

const originalApiKey = process.env.KUN_NEXTMOE_API_KEY

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' }
  })

const problemResponse = (
  status: number,
  code: string,
  headers: Record<string, string> = {}
) =>
  new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, code }),
    {
      status,
      headers: { 'Content-Type': 'application/problem+json', ...headers }
    }
  )

const companyFixture = {
  object: 'company',
  id: 'c_01',
  display_name: 'KOEI Co., Ltd.',
  latin: 'KOEI',
  aliases: [
    { value: 'コーエー', lang: 'ja', alias_kind: 'kana' },
    { value: '光栄', lang: 'ja', is_machine: true },
    { value: 'Koei', is_machine: false }
  ],
  unknown_field: 'ignored'
}

beforeEach(() => {
  delete process.env.KUN_NEXTMOE_API_KEY
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.KUN_NEXTMOE_API_KEY
  } else {
    process.env.KUN_NEXTMOE_API_KEY = originalApiKey
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isNextmoeCatalogConfigured', () => {
  it('requires a non-empty KUN_NEXTMOE_API_KEY', () => {
    expect(isNextmoeCatalogConfigured()).toBe(false)

    process.env.KUN_NEXTMOE_API_KEY = 'nextmoe-key'
    expect(isNextmoeCatalogConfigured()).toBe(true)

    process.env.KUN_NEXTMOE_API_KEY = ''
    expect(isNextmoeCatalogConfigured()).toBe(false)
  })
})

describe('createNextmoeCatalogClient without an api key', () => {
  it('returns the requested refs as missing without calling fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient()
    const list = await client.listWorksByRefs(['vndb:v2168', 'bangumi:21041'])

    expect(list).toEqual({
      object: 'list',
      items: [],
      missing: ['vndb:v2168', 'bangumi:21041']
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('listWorksByRefs', () => {
  it('parses refs and companies and strips unknown fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        object: 'list',
        items: [
          {
            object: 'work',
            id: 'w_01',
            refs: [
              { source: 'vndb', external_id: 'v2168', extra: 'ignored' },
              { source: 'bangumi', external_id: '21041' },
              { source: 'nextmoe', external_id: 'w_01' }
            ],
            companies: [
              {
                object: 'company',
                id: 'c_01',
                display_name: 'KOEI Co., Ltd.',
                company_kind: 'developer',
                attribution_role: 'developer'
              }
            ],
            unknown_field: { nested: true }
          }
        ],
        unknown_envelope_field: true
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key' })
    const list = await client.listWorksByRefs(['vndb:v2168', 'bangumi:21041'])

    expect(list.missing).toBeUndefined()
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toEqual({
      object: 'work',
      id: 'w_01',
      refs: [
        { source: 'vndb', external_id: 'v2168' },
        { source: 'bangumi', external_id: '21041' },
        { source: 'nextmoe', external_id: 'w_01' }
      ],
      companies: [
        {
          object: 'company',
          id: 'c_01',
          display_name: 'KOEI Co., Ltd.',
          company_kind: 'developer',
          attribution_role: 'developer'
        }
      ]
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.nextmoe.dev/v2/catalog/works?refs=vndb:v2168,bangumi:21041&include=companies,refs&nsfw=true'
    )
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer nextmoe-key'
    })
  })

  it('passes through the missing keys reported by the server', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        object: 'list',
        items: [{ object: 'work', id: 'w_01' }],
        missing: ['bangumi:21041']
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key' })
    const list = await client.listWorksByRefs(['vndb:v2168', 'bangumi:21041'])

    expect(list.items).toEqual([{ object: 'work', id: 'w_01' }])
    expect(list.missing).toEqual(['bangumi:21041'])
  })
})

describe('listCompaniesByIds', () => {
  it('parses aliases and drops machine generated ones from alias values', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ object: 'list', items: [companyFixture] })
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key' })
    const list = await client.listCompaniesByIds(['c_01'])

    expect(list.items[0]).toEqual({
      object: 'company',
      id: 'c_01',
      display_name: 'KOEI Co., Ltd.',
      latin: 'KOEI',
      aliases: [
        { value: 'コーエー', lang: 'ja', alias_kind: 'kana' },
        { value: '光栄', lang: 'ja', is_machine: true },
        { value: 'Koei', is_machine: false }
      ]
    })
    expect(nextmoeAliasValues(list.items[0])).toEqual([
      'KOEI Co., Ltd.',
      'コーエー',
      'Koei'
    ])

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.nextmoe.dev/v2/catalog/companies?ids=c_01&include=aliases&nsfw=true'
    )
  })

  it('drops alias values over the length limit instead of slicing them', async () => {
    const tooLong = 'あ'.repeat(NEXTMOE_COMPANY_VALUE_MAX_LENGTH + 1)
    const atLimit = 'b'.repeat(NEXTMOE_COMPANY_VALUE_MAX_LENGTH)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        object: 'list',
        items: [
          {
            object: 'company',
            id: 'c_02',
            display_name: '   ',
            aliases: [
              { value: `  ${tooLong}  ` },
              { value: atLimit },
              { value: '' },
              { value: '   ' }
            ]
          }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key' })
    const list = await client.listCompaniesByIds(['c_02'])
    const values = nextmoeAliasValues(list.items[0])

    expect(values).toEqual([atLimit])
    expect(values).not.toContain('あ'.repeat(NEXTMOE_COMPANY_VALUE_MAX_LENGTH))
  })

  it('reports a merged entity as a missing key without retrying', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(problemResponse(404, 'ENTITY_MERGED'))
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key' })
    const list = await client.listCompaniesByIds(['c_01', 'c_02'])

    expect(list).toEqual({
      object: 'list',
      items: [],
      missing: ['c_01', 'c_02']
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('batch lane limits', () => {
  it('rejects more than 100 keys before calling fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key' })
    const refs = Array.from({ length: 101 }, (_, index) => `vndb:v${index}`)

    await expect(client.listWorksByRefs(refs)).rejects.toThrow(
      'NextMoe catalog batch lanes accept at most 100 keys, received 101'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts exactly 100 keys', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ object: 'list', items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key' })
    const ids = Array.from({ length: 100 }, (_, index) => `c_${index}`)
    const list = await client.listCompaniesByIds(ids)

    expect(list).toEqual({ object: 'list', items: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('fail open behaviour', () => {
  it('disables the client after a 401 without retrying', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(problemResponse(401, 'UNAUTHORIZED'))
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key', sleep })

    const first = await client.listWorksByRefs(['vndb:v2168'])
    expect(first).toEqual({
      object: 'list',
      items: [],
      missing: ['vndb:v2168']
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()

    const second = await client.listCompaniesByIds(['c_01'])
    expect(second).toEqual({ object: 'list', items: [], missing: ['c_01'] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a rate limited request once after sleeping', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        problemResponse(429, 'RATE_LIMITED', { 'Retry-After': '1' })
      )
      .mockResolvedValueOnce(
        jsonResponse({ object: 'list', items: [companyFixture] })
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key', sleep })
    const list = await client.listCompaniesByRefs(['vndb:p2168'])

    expect(list.items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(1000)
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(1100)
  })

  it('clamps Retry-After to one minute and defaults to one second', async () => {
    const longWait = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const longWaitFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        problemResponse(429, 'RATE_LIMITED', { 'Retry-After': '600' })
      )
      .mockResolvedValueOnce(jsonResponse({ object: 'list', items: [] }))
    vi.stubGlobal('fetch', longWaitFetch)

    await createNextmoeCatalogClient({
      apiKey: 'nextmoe-key',
      sleep: longWait
    }).listCompaniesByIds(['c_01'])

    expect(longWait.mock.calls[0][0]).toBeGreaterThanOrEqual(60000)
    expect(longWait.mock.calls[0][0]).toBeLessThanOrEqual(60100)

    const noHeader = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const noHeaderFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(problemResponse(429, 'RATE_LIMITED'))
      .mockResolvedValueOnce(jsonResponse({ object: 'list', items: [] }))
    vi.stubGlobal('fetch', noHeaderFetch)

    await createNextmoeCatalogClient({
      apiKey: 'nextmoe-key',
      sleep: noHeader
    }).listCompaniesByIds(['c_01'])

    expect(noHeader.mock.calls[0][0]).toBeGreaterThanOrEqual(1000)
    expect(noHeader.mock.calls[0][0]).toBeLessThanOrEqual(1100)
  })

  it('does not retry an exceeded quota and disables the client', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(problemResponse(429, 'QUOTA_EXCEEDED'))
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key', sleep })

    const first = await client.listCompaniesByRefs(['vndb:p2168'])
    expect(first).toEqual({
      object: 'list',
      items: [],
      missing: ['vndb:p2168']
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()

    const second = await client.listWorksByRefs(['vndb:v2168'])
    expect(second).toEqual({
      object: 'list',
      items: [],
      missing: ['vndb:v2168']
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a server error once before succeeding', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ code: 'INTERNAL' }, { status: 503 })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          object: 'list',
          items: [{ object: 'work', id: 'w_01' }]
        })
      )

    const client = createNextmoeCatalogClient({
      apiKey: 'nextmoe-key',
      fetch: fetchMock,
      sleep
    })
    const list = await client.listWorksByRefs(['vndb:v2168'])

    expect(list.items).toEqual([{ object: 'work', id: 'w_01' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(200)
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(300)
  })

  it('gives up after two server error retries', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ code: 'INTERNAL' }, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key', sleep })
    const list = await client.listWorksByRefs(['vndb:v2168'])

    expect(list).toEqual({
      object: 'list',
      items: [],
      missing: ['vndb:v2168']
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls[1][0]).toBeGreaterThanOrEqual(400)
    expect(sleep.mock.calls[1][0]).toBeLessThanOrEqual(500)
  })

  it('treats an unknown problem code as a failure of its HTTP status', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(problemResponse(400, 'SOMETHING_NEW'))
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key' })
    const list = await client.listCompaniesByIds(['c_01'])

    expect(list).toEqual({ object: 'list', items: [], missing: ['c_01'] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resolves as missing when the response body is not a valid list', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ object: 'work', id: 'w_01' }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createNextmoeCatalogClient({ apiKey: 'nextmoe-key' })
    const list = await client.listWorksByRefs(['vndb:v2168'])

    expect(list).toEqual({
      object: 'list',
      items: [],
      missing: ['vndb:v2168']
    })
  })
})
