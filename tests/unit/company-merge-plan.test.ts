import { describe, expect, it } from 'vitest'
import {
  buildAutoAliasCompanyMergePlan,
  getEmptyCompanyDeletionCandidates,
  getCompanyMergePreview
} from '~/scripts/companyMergePlan'

describe('company merge plan', () => {
  it('builds a merge when a company name appears in another company alias', () => {
    const result = buildAutoAliasCompanyMergePlan([
      { id: 1, name: 'Canonical Studio', alias: ['Old Studio'] },
      { id: 2, name: 'Old Studio', alias: ['Old Co.'] }
    ])

    expect(result.warnings).toEqual([])
    expect(result.merges).toEqual([
      {
        targetCompanyId: 1,
        targetName: 'Canonical Studio',
        sourceCompanyIds: [2],
        sourceNames: ['Old Studio']
      }
    ])
  })

  it('skips ambiguous companies matched by multiple alias owners', () => {
    const result = buildAutoAliasCompanyMergePlan([
      { id: 1, name: 'First Studio', alias: ['Shared Studio'] },
      { id: 2, name: 'Second Studio', alias: ['Shared Studio'] },
      { id: 3, name: 'Shared Studio', alias: [] }
    ])

    expect(result.merges).toEqual([])
    expect(result.warnings).toEqual([
      'Skip ambiguous company "Shared Studio" (#3); matched targets #1 First Studio, #2 Second Studio'
    ])
  })

  it('warns about shared aliases that do not identify a source company', () => {
    const result = buildAutoAliasCompanyMergePlan([
      { id: 1, name: 'First Studio', alias: ['Brand X'] },
      { id: 2, name: 'Second Studio', alias: ['Brand X'] }
    ])

    expect(result.merges).toEqual([])
    expect(result.warnings).toEqual([
      'Shared alias "Brand X" appears in #1 First Studio, #2 Second Studio; choose a canonical company manually'
    ])
  })

  it('previews merged aliases and metadata without duplicating values', () => {
    const preview = getCompanyMergePreview(
      {
        id: 1,
        name: 'Canonical Studio',
        alias: ['Old Studio'],
        count: 1,
        primary_language: ['ja'],
        official_website: ['https://canonical.example'],
        parent_brand: [],
        _count: { patch_relations: 1 }
      },
      [
        {
          id: 2,
          name: 'Old Studio',
          alias: ['Old Co.', 'Canonical Studio'],
          count: 2,
          primary_language: ['ja', 'en'],
          official_website: ['https://old.example'],
          parent_brand: ['Parent Brand'],
          _count: { patch_relations: 2 }
        }
      ],
      ['Plan Alias']
    )

    expect(preview).toEqual({
      relationCount: 2,
      nextAliases: ['Old Studio', 'Old Co.', 'Plan Alias'],
      nextPrimaryLanguage: ['ja', 'en'],
      nextOfficialWebsite: [
        'https://canonical.example',
        'https://old.example'
      ],
      nextParentBrand: ['Parent Brand']
    })
  })

  it('plans deletion only for empty companies outside merge plans', () => {
    const candidates = getEmptyCompanyDeletionCandidates(
      [
        { id: 1, name: 'Active Studio', _count: { patch_relations: 2 } },
        { id: 2, name: 'Empty Studio', _count: { patch_relations: 0 } },
        { id: 3, name: 'Merge Source', _count: { patch_relations: 0 } }
      ],
      new Set([3])
    )

    expect(candidates).toEqual([
      { id: 2, name: 'Empty Studio', relationCount: 0 }
    ])
  })
})
