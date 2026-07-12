import { describe, expect, it, vi } from 'vitest'
import {
  KNOWN_RELEASED_PATTERN_INDEX_DIFF,
  classifyPrismaDiff,
  isExpectedReleasedPatternIndex,
  runPrismaProductionSchemaGuard,
  type ReleasedPatternIndexMetadata
} from '~/scripts/prismaProductionSchemaGuard'

const validIndex: ReleasedPatternIndexMetadata = {
  schema_name: 'public',
  table_name: 'patch',
  index_name: 'patch_released_idx',
  column_name: 'released',
  access_method: 'btree',
  operator_class: 'text_pattern_ops',
  key_attribute_count: 1,
  total_attribute_count: 1,
  is_unique: false,
  is_primary: false,
  is_valid: true,
  is_ready: true,
  is_live: true,
  has_no_predicate: true,
  has_no_expression: true
}

describe('classifyPrismaDiff', () => {
  it('accepts an empty diff exit', () => {
    expect(classifyPrismaDiff({ exitCode: 0, stdout: '' })).toBe('clean')
  })

  it('accepts only the known released pattern index false drift', () => {
    expect(
      classifyPrismaDiff({
        exitCode: 2,
        stdout: `\r\n${KNOWN_RELEASED_PATTERN_INDEX_DIFF.replaceAll('\n', '\r\n')}\r\n`
      })
    ).toBe('known-released-pattern-index')
  })

  it.each([
    `${KNOWN_RELEASED_PATTERN_INDEX_DIFF}\nDROP TABLE "patch";`,
    KNOWN_RELEASED_PATTERN_INDEX_DIFF.replace('text_pattern_ops', 'text_ops'),
    '-- DropIndex\nDROP INDEX "other_idx";'
  ])('rejects altered or additional SQL: %s', (stdout) => {
    expect(classifyPrismaDiff({ exitCode: 2, stdout })).toBe('unexpected')
  })

  it('rejects Prisma command errors', () => {
    expect(classifyPrismaDiff({ exitCode: 1, stdout: '' })).toBe('unexpected')
  })
})

describe('isExpectedReleasedPatternIndex', () => {
  it('accepts the exact live single-column pattern index', () => {
    expect(isExpectedReleasedPatternIndex(validIndex)).toBe(true)
  })

  it.each([
    { operator_class: 'text_ops' },
    { column_name: 'name' },
    { key_attribute_count: 2 },
    { total_attribute_count: 2 },
    { is_valid: false },
    { is_ready: false },
    { is_live: false },
    { has_no_predicate: false },
    { has_no_expression: false }
  ])('rejects mismatched metadata: %o', (change) => {
    expect(isExpectedReleasedPatternIndex({ ...validIndex, ...change })).toBe(
      false
    )
  })
})

describe('runPrismaProductionSchemaGuard', () => {
  it('does not query PostgreSQL for an empty diff', async () => {
    const loadIndexMetadata = vi.fn()

    await expect(
      runPrismaProductionSchemaGuard({
        runDiff: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
        loadIndexMetadata,
        log: vi.fn()
      })
    ).resolves.toBe('clean')
    expect(loadIndexMetadata).not.toHaveBeenCalled()
  })

  it('validates PostgreSQL metadata before accepting the known exception', async () => {
    const loadIndexMetadata = vi.fn().mockResolvedValue([validIndex])

    await expect(
      runPrismaProductionSchemaGuard({
        runDiff: async () => ({
          exitCode: 2,
          stdout: KNOWN_RELEASED_PATTERN_INDEX_DIFF,
          stderr: ''
        }),
        loadIndexMetadata,
        log: vi.fn()
      })
    ).resolves.toBe('known-released-pattern-index')
    expect(loadIndexMetadata).toHaveBeenCalledTimes(1)
  })

  it('fails closed for extra drift without querying PostgreSQL', async () => {
    const loadIndexMetadata = vi.fn()

    await expect(
      runPrismaProductionSchemaGuard({
        runDiff: async () => ({
          exitCode: 2,
          stdout: `${KNOWN_RELEASED_PATTERN_INDEX_DIFF}\n-- CreateTable`,
          stderr: ''
        }),
        loadIndexMetadata,
        log: vi.fn()
      })
    ).rejects.toThrow('Unexpected Prisma schema drift')
    expect(loadIndexMetadata).not.toHaveBeenCalled()
  })

  it.for([[], [validIndex, validIndex], [{ ...validIndex, is_valid: false }]])(
    'fails closed for invalid catalog rows: %o',
    async (rows) => {
      await expect(
        runPrismaProductionSchemaGuard({
          runDiff: async () => ({
            exitCode: 2,
            stdout: KNOWN_RELEASED_PATTERN_INDEX_DIFF,
            stderr: ''
          }),
          loadIndexMetadata: async () => rows,
          log: vi.fn()
        })
      ).rejects.toThrow('catalog validation failed')
    }
  )
})
