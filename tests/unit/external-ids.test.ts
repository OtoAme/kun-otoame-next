import { describe, expect, it } from 'vitest'
import {
  normalizeBangumiIdInput,
  normalizeSteamIdInput,
  normalizeVndbIdInput,
  normalizeVndbRelationIdInput,
  parseBangumiIdInput,
  parseSteamIdInput,
  parseVndbIdInput,
  parseVndbRelationIdInput
} from '~/utils/externalIds'

describe('external id parsing', () => {
  it('parses direct VNDB IDs and VNDB visual novel links', () => {
    expect(parseVndbIdInput('v19658')).toBe('v19658')
    expect(parseVndbIdInput('https://vndb.org/v19658')).toBe('v19658')
    expect(parseVndbIdInput('vndb.org/v19658/chars')).toBe('v19658')
    expect(parseVndbIdInput('https://vndb.org/v64588/cv#cv')).toBe('v64588')
    expect(parseVndbIdInput('https://example.com/v19658')).toBe('')
  })

  it('parses direct VNDB release IDs and release links', () => {
    expect(parseVndbRelationIdInput('r5879')).toBe('r5879')
    expect(parseVndbRelationIdInput('https://vndb.org/r5879')).toBe('r5879')
    expect(parseVndbRelationIdInput('vndb.org/r5879')).toBe('r5879')
    expect(parseVndbRelationIdInput('https://vndb.org/v19658')).toBe('')
  })

  it('parses direct Bangumi IDs and subject links', () => {
    expect(parseBangumiIdInput('172612')).toBe('172612')
    expect(parseBangumiIdInput('https://bgm.tv/subject/172612')).toBe('172612')
    expect(parseBangumiIdInput('bangumi.tv/subject/172612')).toBe('172612')
    expect(parseBangumiIdInput('https://chii.in/subject/172612')).toBe('172612')
    expect(parseBangumiIdInput('https://bgm.tv/subject/465493#;')).toBe(
      '465493'
    )
    expect(parseBangumiIdInput('https://bgm.tv/character/172612')).toBe('')
  })

  it('parses direct Steam app IDs and app links', () => {
    expect(parseSteamIdInput('3655150')).toBe('3655150')
    expect(
      parseSteamIdInput('https://store.steampowered.com/app/3655150')
    ).toBe('3655150')
    expect(
      parseSteamIdInput(
        'https://store.steampowered.com/app/3655150/Game_Name/?l=schinese'
      )
    ).toBe('3655150')
    expect(
      parseSteamIdInput('store.steampowered.com/app/3655150#reviews')
    ).toBe('3655150')
    expect(
      parseSteamIdInput('https://store.steampowered.com/sub/3655150')
    ).toBe('')
  })

  it('keeps invalid inputs unchanged when normalizing for fetch validation', () => {
    expect(normalizeVndbIdInput('https://example.com/v19658')).toBe(
      'https://example.com/v19658'
    )
    expect(normalizeVndbRelationIdInput('https://vndb.org/v19658')).toBe(
      'https://vndb.org/v19658'
    )
    expect(normalizeBangumiIdInput('https://bgm.tv/character/172612')).toBe(
      'https://bgm.tv/character/172612'
    )
    expect(
      normalizeSteamIdInput('https://store.steampowered.com/sub/3655150')
    ).toBe('https://store.steampowered.com/sub/3655150')
  })
})
