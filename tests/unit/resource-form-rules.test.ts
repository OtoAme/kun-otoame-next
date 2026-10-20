import { describe, expect, it } from 'vitest'
import {
  applyStorageSwitch,
  applyTypeChange,
  getChineseSupportOptions,
  getDefaultLinkStorage,
  getDisabledStorageKeys,
  getResourceTypeGroups,
  splitTypesByChineseSupport
} from '~/utils/resourceFormRules'

describe('resource form rules', () => {
  it('splits chinese support types from the stored type array', () => {
    expect(splitTypesByChineseSupport(['pc', 'chinese', 'tool'])).toEqual({
      gameAndOther: ['pc', 'tool'],
      chineseSupport: ['chinese']
    })
  })

  it('groups game types before other types and keeps patch types flat', () => {
    const galgameGroups = getResourceTypeGroups('galgame')
    expect(galgameGroups.map((group) => group.key)).toEqual([
      'game-types',
      'other-types'
    ])
    expect(galgameGroups[0]!.options.map((option) => option.value)).toEqual([
      'pc',
      'emulator',
      'mobile'
    ])
    expect(
      galgameGroups[1]!.options.some((option) => option.value === 'material')
    ).toBe(true)
    expect(
      galgameGroups[1]!.options.some((option) => option.value === 'chinese')
    ).toBe(false)

    const patchGroups = getResourceTypeGroups('patch')
    expect(
      patchGroups.flatMap((group) =>
        group.options.map((option) => option.value)
      )
    ).toEqual(['tool', 'patch', 'other-patch', 'strategy', 'save'])
  })

  it('lists chinese support options only for the game section', () => {
    expect(getChineseSupportOptions('galgame').map((o) => o.value)).toEqual([
      'official-zh',
      'chinese',
      'machine',
      'row'
    ])
    expect(getChineseSupportOptions('patch')).toEqual([])
  })

  it('drops chinese support and filters platforms when types make it inapplicable', () => {
    const next = applyTypeChange(
      'galgame',
      ['material', 'chinese'],
      ['windows', 'other']
    )
    expect(next.types).toEqual(['material'])
    expect(next.chineseSupportSelectable).toBe(false)
    expect(next.chineseSupportRequired).toBe(false)
    expect(next.platforms).toEqual(['other'])
  })

  it('keeps chinese support and requires it when a game type is selected', () => {
    const next = applyTypeChange(
      'galgame',
      ['pc', 'chinese'],
      ['windows', 'android']
    )
    expect(next.types).toEqual(['pc', 'chinese'])
    expect(next.chineseSupportSelectable).toBe(true)
    expect(next.chineseSupportRequired).toBe(true)
    expect(next.platforms).toEqual(['windows'])
  })

  it('keeps every platform for the patch section', () => {
    const next = applyTypeChange('patch', ['patch'], ['windows', 'psp'])
    expect(next.platforms).toEqual(['windows', 'psp'])
  })

  it.each([
    [4, 'galgame', 'touchgal'],
    [4, 'patch', 'touchgal'],
    [3, 'galgame', 'user'],
    [2, 'galgame', 'user'],
    [3, 'patch', 's3'],
    [2, 'patch', 's3'],
    [1, 'galgame', 'user'],
    [1, 'patch', 'user']
  ])('defaults storage for role %i in %s to %s', (role, section, expected) => {
    expect(getDefaultLinkStorage(section, role)).toBe(expected)
  })

  it.each([
    [4, 'galgame', []],
    [4, 'patch', []],
    [3, 'galgame', ['s3', 'touchgal']],
    [2, 'patch', ['touchgal']],
    [1, 'galgame', ['s3', 'touchgal']],
    [1, 'patch', ['s3', 'touchgal']]
  ])('disables storages for role %i in %s', (role, section, expected) => {
    expect(getDisabledStorageKeys(section, role)).toEqual(expected)
  })

  it('clears content, hash and upload when leaving s3 but keeps size and codes', () => {
    const link = {
      storage: 's3',
      content: 'https://cdn.example/a',
      hash: 'abc',
      size: '9MB',
      code: 'code',
      password: 'pw',
      uploadId: 'up-1'
    }
    const next = applyStorageSwitch(link, 'user')
    expect(next).toEqual({
      storage: 'user',
      content: '',
      hash: '',
      size: '9MB',
      code: 'code',
      password: 'pw'
    })
    expect('uploadId' in next).toBe(false)
  })

  it('clears only content when switching to s3', () => {
    const link = {
      storage: 'user',
      content: 'https://pan.example/a',
      hash: 'user-hash',
      size: '2GB',
      code: 'code',
      password: 'pw'
    }
    expect(applyStorageSwitch(link, 's3')).toEqual({
      storage: 's3',
      content: '',
      hash: 'user-hash',
      size: '2GB',
      code: 'code',
      password: 'pw'
    })
  })
})
