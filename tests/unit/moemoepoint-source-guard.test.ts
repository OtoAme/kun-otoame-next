import { readFile } from 'node:fs/promises'
import { globby } from 'globby'
import { describe, expect, it } from 'vitest'

describe('moemoepoint source guard', () => {
  it('keeps direct balance writes inside the ledger service', async () => {
    const files = await globby([
      'app/**/*.{ts,tsx}',
      '!app/api/moemoepoint/service.ts'
    ])
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (
        /moemoepoint\s*:\s*\{\s*(increment|decrement|set)\s*:/m.test(source) ||
        /SET\s+moemoepoint\s*=/im.test(source)
      ) {
        violations.push(file)
      }
    }

    expect(violations).toEqual([])
  })

  it('uses HeroUI v2 controls for the new interactive pages', async () => {
    const [ledger, rules] = await Promise.all([
      readFile('components/moemoepoint/LedgerContainer.tsx', 'utf8'),
      readFile('components/moemoepoint/Rules.tsx', 'utf8')
    ])

    for (const component of ['DateRangePicker', 'Tabs', 'Table', 'Chip']) {
      expect(ledger).toContain(component)
    }
    for (const component of ['Card', 'Table', 'Divider']) {
      expect(rules).toContain(component)
    }
    expect(`${ledger}\n${rules}`).not.toMatch(
      /<(button|input|select|textarea)\b/
    )
  })
})
