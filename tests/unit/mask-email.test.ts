import { describe, expect, it } from 'vitest'
import { EMAIL_MASK, maskEmails, searchesIntoEmail } from '~/utils/maskEmail'

describe('maskEmails', () => {
  it('masks addresses inside JSON dumps written by user edits', () => {
    const content = `管理员 七海 更改了一个用户的信息\n\n更改内容:\n${JSON.stringify(
      {
        uid: 7,
        email: 'new.addr+tag@mail.example.co.jp'
      }
    )}\n\n原用户信息:\n${JSON.stringify({ id: 7, email: 'Old_Addr@Example.COM' })}`
    const masked = maskEmails(content)
    expect(masked).not.toMatch(/@/)
    expect(masked.split(EMAIL_MASK)).toHaveLength(3)
    // The surrounding JSON stays readable.
    expect(masked).toContain(`"email":"${EMAIL_MASK}"`)
    expect(masked).toContain('"uid":7')
  })

  it('masks addresses typed into free text such as a reason', () => {
    expect(maskEmails('拒绝原因：请联系 a@b.cn，或 c.d@e-f.org。')).toBe(
      `拒绝原因：请联系 ${EMAIL_MASK}，或 ${EMAIL_MASK}。`
    )
  })

  it('stays fast on the longest log text without an address', () => {
    const text = 'a'.repeat(10007)
    const start = performance.now()
    expect(maskEmails(text)).toBe(text)
    // Unanchored, this input costs tens of milliseconds per log row.
    expect(performance.now() - start).toBeLessThan(20)
  })

  it('masks an address that ends a long run of letters', () => {
    expect(maskEmails(`${'a'.repeat(3000)}@${'b'.repeat(3000)}.cn`)).toBe(
      EMAIL_MASK
    )
  })

  it('leaves text without an address untouched', () => {
    for (const text of [
      '管理员 七海 同意了一位创作者申请',
      '提及 @kuro 的评论',
      'user@localhost',
      '两步验证 (ID: 7)'
    ]) {
      expect(maskEmails(text)).toBe(text)
    }
  })
})

describe('searchesIntoEmail', () => {
  it.each([
    ['@', true],
    ['gmail.com@', true],
    ['a@b', true],
    ['kuro', false],
    ['example.com', false]
  ])('%s -> %s', (term, expected) => {
    expect(searchesIntoEmail(term)).toBe(expected)
  })
})
