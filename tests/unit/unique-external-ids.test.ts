import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  patch: { findFirst: vi.fn() }
}))

vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

import {
  findFirstUniqueExternalIdDuplicate,
  findPatchByExternalId,
  resolveUniqueExternalIdConstraintMessage
} from '~/app/api/edit/uniqueExternalIds'
import { patchCreateSchema, patchUpdateSchema } from '~/validations/edit'

const p2002 = (target: string[]) => ({ code: 'P2002', meta: { target } })

beforeEach(() => {
  prismaMocks.patch.findFirst.mockReset()
  prismaMocks.patch.findFirst.mockResolvedValue(null)
})

describe('release id normalization', () => {
  it('stores the lowercased release id so a plain unique index can enforce it', () => {
    const parsed = patchCreateSchema.shape.vndbRelationId.parse('R5879')
    expect(parsed).toBe('r5879')
  })

  it('rejects a release id with surrounding whitespace instead of trimming it', () => {
    expect(() =>
      patchCreateSchema.shape.vndbRelationId.parse(' R5879 ')
    ).toThrow()
  })

  it('normalizes on the update path too', () => {
    const parsed = patchUpdateSchema.shape.vndbRelationId.parse('R42')
    expect(parsed).toBe('r42')
  })

  it('keeps an empty release id empty', () => {
    expect(patchCreateSchema.shape.vndbRelationId.parse('')).toBe('')
  })
})

describe('unique external id lookups', () => {
  it('looks up a release id case insensitively', async () => {
    await findPatchByExternalId('vndbRelationId', 'R5879')
    expect(prismaMocks.patch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ vndb_relation_id: 'r5879' })
      })
    )
  })

  it('uppercases a dlsite code before looking it up', async () => {
    await findPatchByExternalId('dlsiteCode', ' rj01234 ')
    expect(prismaMocks.patch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dlsite_code: 'RJ01234' })
      })
    )
  })

  it('skips blank values instead of matching every null row', async () => {
    expect(await findPatchByExternalId('vndbRelationId', '   ')).toBeNull()
    expect(prismaMocks.patch.findFirst).not.toHaveBeenCalled()
  })

  it('excludes the patch being edited', async () => {
    await findPatchByExternalId('vndbRelationId', 'r1', 7)
    expect(prismaMocks.patch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 7 } })
      })
    )
  })

  it('reports the first duplicated field', async () => {
    prismaMocks.patch.findFirst.mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where
      return Promise.resolve(
        where.vndb_relation_id ? { unique_id: 'abcd1234' } : null
      )
    })

    const duplicate = await findFirstUniqueExternalIdDuplicate({
      bangumiId: '1',
      vndbRelationId: 'r1'
    })
    expect(duplicate).toEqual({
      field: 'vndbRelationId',
      patch: { unique_id: 'abcd1234' }
    })
  })
})

describe('unique constraint error mapping', () => {
  it('turns a release id conflict into a readable message', async () => {
    prismaMocks.patch.findFirst.mockResolvedValue({ unique_id: 'abcd1234' })

    const message = await resolveUniqueExternalIdConstraintMessage(
      p2002(['vndb_relation_id']),
      { vndbRelationId: 'r5879' }
    )
    expect(message).toBe('Release ID 与游戏 ID 为 abcd1234 的游戏重复')
  })

  it('covers dlsite codes as well', async () => {
    prismaMocks.patch.findFirst.mockResolvedValue({ unique_id: 'ffff0000' })

    const message = await resolveUniqueExternalIdConstraintMessage(
      p2002(['dlsite_code']),
      { dlsiteCode: 'RJ01234' }
    )
    expect(message).toBe('DLSite Code 与游戏 ID 为 ffff0000 的游戏重复')
  })

  it('still answers when the conflicting row cannot be found', async () => {
    const message = await resolveUniqueExternalIdConstraintMessage(
      p2002(['vndb_relation_id']),
      { vndbRelationId: 'r5879' }
    )
    expect(message).toBe('Release ID 已存在，请检查是否重复发布')
  })

  it('leaves unrelated errors to the caller', async () => {
    expect(
      await resolveUniqueExternalIdConstraintMessage(p2002(['name']), {})
    ).toBeNull()
    expect(
      await resolveUniqueExternalIdConstraintMessage(new Error('boom'), {})
    ).toBeNull()
  })
})
