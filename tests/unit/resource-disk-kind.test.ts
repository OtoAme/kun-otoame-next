import { describe, expect, it } from 'vitest'
import {
  recognizeResourceDiskKind,
  resolveDisplayedDiskKind
} from '~/utils/resourceDiskKind'

describe('recognizeResourceDiskKind', () => {
  it('keeps netdisk detection on the share host', () => {
    expect(
      recognizeResourceDiskKind('https://pan.baidu.com/s/1SYN', 'user')
    ).toBe('baidu')
    expect(
      recognizeResourceDiskKind('https://pan.quark.cn/s/SYN', 'user')
    ).toBe('quark')
  })

  it('treats pan.otoame.top as the OtoAme disk', () => {
    expect(
      recognizeResourceDiskKind(
        '地址 https://pan.otoame.top/s/ui479c1f',
        'touchgal'
      )
    ).toBe('otoame')
  })

  it('does not treat a lookalike host as the OtoAme disk', () => {
    expect(
      recognizeResourceDiskKind('https://pan.otoame.top.evil.test/s/x', 'user')
    ).toBe('other')
    expect(
      recognizeResourceDiskKind('http://pan.otoame.top/s/x', 'touchgal')
    ).toBe('other')
  })

  it('labels object storage and unrecognized links', () => {
    expect(
      recognizeResourceDiskKind(
        'https://storage.example.test/ui479c1f/object.zip',
        's3'
      )
    ).toBe('object')
    expect(
      recognizeResourceDiskKind('https://example.com/share/plain', 'user')
    ).toBe('other')
    expect(recognizeResourceDiskKind('', 's3')).toBe('object')
    expect(recognizeResourceDiskKind('', 'user')).toBe('other')
  })

  it('prefers a known domain over object storage', () => {
    expect(
      recognizeResourceDiskKind('https://pan.baidu.com/s/1SYN', 's3')
    ).toBe('baidu')
  })
})

describe('resolveDisplayedDiskKind', () => {
  it('uses the health provider when the public link has no address', () => {
    expect(
      resolveDisplayedDiskKind({
        storage: 'user',
        healthProvider: 'quark'
      })
    ).toBe('quark')
  })

  it('reclassifies from the revealed address', () => {
    expect(
      resolveDisplayedDiskKind({
        storage: 'user',
        diskKind: 'other',
        content: 'https://pan.otoame.top/s/ui479c1f'
      })
    ).toBe('otoame')
  })
})
