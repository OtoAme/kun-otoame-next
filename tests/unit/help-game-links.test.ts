import { describe, expect, it } from 'vitest'
import { describeHelpGameLink } from '~/utils/helpGameLinks'
import { helpPostCreateSchema } from '~/validations/help'

const base = {
  requestId: '00000000-0000-4000-8000-000000000001',
  category: 'request',
  title: '求一部游戏',
  content: '站内搜不到这部游戏，想问问有没有人有'
}

describe('help game reference links', () => {
  it('labels VNDB, Bangumi and Steam pages, and other sites by host', () => {
    expect(describeHelpGameLink('https://vndb.org/v12345').label).toBe(
      'VNDB v12345'
    )
    expect(describeHelpGameLink('https://bgm.tv/subject/9876').label).toBe(
      'Bangumi 9876'
    )
    expect(
      describeHelpGameLink('https://store.steampowered.com/app/555/x/').label
    ).toBe('Steam 555')
    expect(describeHelpGameLink('https://example.co.jp/game/').label).toBe(
      'example.co.jp'
    )
  })

  it('keeps several links with a game name, trimming blanks and duplicates', () => {
    const parsed = helpPostCreateSchema.parse({
      ...base,
      gameName: '月下的约定',
      gameLinks: [
        ' https://vndb.org/v1 ',
        '',
        'https://vndb.org/v1',
        'https://bgm.tv/subject/2'
      ]
    })
    expect(parsed.gameLinks).toEqual([
      'https://vndb.org/v1',
      'https://bgm.tv/subject/2'
    ])
  })

  it('refuses non-http links, too many links, and links without a game name', () => {
    expect(
      helpPostCreateSchema.safeParse({
        ...base,
        gameName: 'x',
        gameLinks: ['javascript:alert(1)']
      }).success
    ).toBe(false)
    expect(
      helpPostCreateSchema.safeParse({
        ...base,
        gameName: 'x',
        gameLinks: Array.from({ length: 6 }, (_, n) => `https://a.example/${n}`)
      }).success
    ).toBe(false)
    expect(
      helpPostCreateSchema.safeParse({
        ...base,
        gameLinks: ['https://vndb.org/v1']
      }).success
    ).toBe(false)
  })
})
