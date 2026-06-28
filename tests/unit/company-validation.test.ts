import { describe, expect, it } from 'vitest'
import { createCompanySchema } from '~/validations/company'

const repeat = (char: string, length: number) => char.repeat(length)

describe('company validation', () => {
  it('accepts company aliases and parent brands up to the company name length', () => {
    const longCompanyText = repeat('a', 107)

    const result = createCompanySchema.safeParse({
      name: 'Example Studio',
      introduction: '',
      alias: [longCompanyText],
      primary_language: ['ja'],
      official_website: [],
      parent_brand: [longCompanyText]
    })

    expect(result.success).toBe(true)
  })
})
