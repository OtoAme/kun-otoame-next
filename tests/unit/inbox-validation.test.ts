import { describe, expect, it } from 'vitest'
import {
  adminInboxIdSchema,
  adminInboxItemSchema,
  adminInboxQuerySchema
} from '~/validations/inbox'

describe('inbox query validation', () => {
  it('defaults to all four sources and the oldest 50 candidates', () => {
    expect(adminInboxQuerySchema.parse({})).toEqual({
      kinds: ['submission', 'resource-apply', 'feedback', 'report'],
      search: '',
      order: 'waiting',
      limitPerKind: 50
    })
  })

  it('decodes one comma-separated source parameter and trims search', () => {
    expect(
      adminInboxQuerySchema.parse({
        kinds: 'submission,report,submission',
        search: '  月光  ',
        limitPerKind: '12',
        order: 'kind'
      })
    ).toEqual({
      kinds: ['submission', 'report'],
      search: '月光',
      limitPerKind: 12,
      order: 'kind'
    })
  })

  it.each(['', 'creator', 'submission,', 'submission,unknown'])(
    'rejects invalid source encoding %j',
    (kinds) =>
      expect(adminInboxQuerySchema.safeParse({ kinds }).success).toBe(false)
  )

  it.each(['0', '-1', '1.5', '51', '', 'NaN', 'Infinity'])(
    'rejects invalid candidate limit %j',
    (limitPerKind) =>
      expect(adminInboxQuerySchema.safeParse({ limitPerKind }).success).toBe(
        false
      )
  )

  it('rejects oversized searches and invalid orders', () => {
    expect(
      adminInboxQuerySchema.safeParse({ search: 'a'.repeat(301) }).success
    ).toBe(false)
    expect(adminInboxQuerySchema.safeParse({ order: 'newest' }).success).toBe(
      false
    )
  })

  it.each([
    '0',
    '-1',
    '1.5',
    '1e2',
    '0x10',
    ' 2',
    '02',
    '9007199254740992',
    'approve'
  ])('rejects unsafe or non-canonical item ID %j', (id) =>
    expect(adminInboxIdSchema.safeParse(id).success).toBe(false)
  )

  it('accepts a positive decimal item ID with a known source', () => {
    expect(adminInboxItemSchema.parse({ kind: 'feedback', id: '123' })).toEqual(
      {
        kind: 'feedback',
        id: 123
      }
    )
    expect(
      adminInboxItemSchema.safeParse({ kind: 'creator', id: '123' }).success
    ).toBe(false)
  })
})
