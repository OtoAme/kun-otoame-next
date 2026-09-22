import { describe, expect, it } from 'vitest'
import { selectLegacyVndbCompanyNames } from '~/app/api/edit/legacyVndbCompanyName'

const names = (
  name: string,
  original?: string | null,
  aliases?: string[]
) => selectLegacyVndbCompanyNames({ name, original, aliases })

describe('selectLegacyVndbCompanyNames', () => {
  it('uses a Han or kana original when the VNDB name is Latin', () => {
    expect(names('Studio', 'スタジオ')).toEqual({
      name: 'スタジオ',
      alias: ['Studio']
    })
    expect(names('Otomate', 'オトメイト')).toEqual({
      name: 'オトメイト',
      alias: ['Otomate']
    })
  })

  it('keeps a Han or kana name and stores a different original as an alias', () => {
    expect(names('工作室', 'Studio')).toEqual({
      name: '工作室',
      alias: ['Studio']
    })
    expect(names('スタジオ', 'Studio')).toEqual({
      name: 'スタジオ',
      alias: ['Studio']
    })
  })

  it('keeps the name when original is missing or blank', () => {
    expect(names('Studio')).toEqual({ name: 'Studio', alias: [] })
    expect(names('Studio', null)).toEqual({ name: 'Studio', alias: [] })
    expect(names('Studio', '   ')).toEqual({ name: 'Studio', alias: [] })
  })

  it('does not let producer aliases choose the primary name', () => {
    expect(names('Studio', 'スタジオ', ['WINGALD', 'スタジオ', 'Studio'])).toEqual({
      name: 'スタジオ',
      alias: ['Studio', 'WINGALD']
    })
  })

  it('drops a blank name', () => {
    expect(names('  ', 'スタジオ')).toBeNull()
  })
})
