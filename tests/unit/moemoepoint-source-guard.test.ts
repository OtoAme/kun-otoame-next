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

  it('keeps ledger loading and narrow-screen tables visually consistent', async () => {
    const [ledger, rules, adminPage] = await Promise.all([
      readFile('components/moemoepoint/LedgerContainer.tsx', 'utf8'),
      readFile('components/moemoepoint/Rules.tsx', 'utf8'),
      readFile('app/admin/user/[id]/moemoepoint/page.tsx', 'utf8')
    ])

    expect(ledger).toContain(
      "import { KunLoading } from '~/components/kun/Loading'"
    )
    expect(ledger).toContain('<KunLoading hint="正在加载萌萌点流水" />')
    expect(ledger).toMatch(
      /loading \? \(\s*<div className="min-h-40">\s*<KunLoading hint="正在加载萌萌点流水" \/>/
    )
    expect(ledger).toContain("classNames={{ td: 'align-top' }}")
    expect(ledger).not.toContain('loadingContent=')
    expect(ledger).not.toContain('<Spinner')
    expect(ledger).not.toContain('isHeaderSticky')

    expect(rules).toContain('<div className="overflow-x-auto">')
    expect(rules.match(/sm:shrink-0/g)).toHaveLength(3)
    expect(rules.match(/sm:whitespace-nowrap/g)).toHaveLength(2)

    expect(adminPage).toContain(
      'title={`「${response.user.name}」的萌萌点流水`}'
    )
  })
})
