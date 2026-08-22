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
    expect(ledger).toMatch(
      /<DateRangePicker[\s\S]*?aria-label="日期范围"[\s\S]*?\/>/
    )
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
    expect(ledger).toContain('<KunLoading hint="正在加载萌萌点明细" />')
    expect(ledger).toMatch(
      /loading \? \(\s*<div className="min-h-40">\s*<KunLoading hint="正在加载萌萌点明细" \/>/
    )
    expect(ledger).toContain("classNames={{ td: 'align-top' }}")
    expect(ledger).not.toContain('loadingContent=')
    expect(ledger).not.toContain('<Spinner')
    expect(ledger).not.toContain('isHeaderSticky')

    expect(rules).toContain('<div className="overflow-x-auto">')
    expect(rules.match(/sm:shrink-0/g)).toHaveLength(3)
    expect(rules.match(/sm:whitespace-nowrap/g)).toHaveLength(2)

    expect(adminPage).toContain(
      'title={`「${response.user.name}」的萌萌点明细`}'
    )
  })

  it('keeps the mobile ledger title row independent from its description', async () => {
    const ledger = await readFile(
      'components/moemoepoint/LedgerContainer.tsx',
      'utf8'
    )

    expect(ledger).toMatch(
      /<KunHeader[\s\S]*?endContent=\{\s*<p className="whitespace-pre-wrap text-default-500">\s*这里汇总了你在 OtoAme 全站的萌萌点收支记录。/
    )
    expect(ledger).toContain(
      'className="shrink-0 self-start whitespace-nowrap"'
    )
    expect(ledger).not.toContain(
      'description="这里汇总了你在 OtoAme 全站的萌萌点收支记录。"'
    )
  })

  it('keeps ledger copy aligned with the current page wording', async () => {
    const ledger = await readFile(
      'components/moemoepoint/LedgerContainer.tsx',
      'utf8'
    )

    expect(ledger).toContain('这里汇总了你在 OtoAme 全站的萌萌点收支记录。')
    expect(ledger).toContain(
      '可用萌萌点 = 总萌萌点 - 待结算萌萌点；消费和余额门槛以可用萌萌点为准。'
    )
    expect(ledger).toMatch(/label:\s*'其他变动'/)
    expect(ledger).toContain('<Tab key="7d" title="7 天内" />')
    expect(ledger).toContain('<Tab key="30d" title="30 天内" />')
    expect(ledger).toContain('单次最多查询')
  })

  it('gives visitors a clear login path instead of an error message', async () => {
    const page = await readFile('app/moemoepoint/page.tsx', 'utf8')

    expect(page).toContain('登录后才能查看自己的萌萌点明细')
    expect(page).toContain('href="/login"')
    expect(page).toContain('href="/register"')
  })

  it('keeps the visitor state server-component compatible', async () => {
    const page = await readFile('app/moemoepoint/page.tsx', 'utf8')

    expect(page).toContain("from '@heroui/button'")
    expect(page).toContain("from '@heroui/card'")
    expect(page).toContain("from '@heroui/link'")
    expect(page).not.toContain("from '@heroui/react'")
  })

  it('keeps the rules page wording aligned with active point checks', async () => {
    const [rules, constants] = await Promise.all([
      readFile('components/moemoepoint/Rules.tsx', 'utf8'),
      readFile('constants/moemoepoint.ts', 'utf8')
    ])

    expect(rules).toContain('扣除与回退')
    expect(rules).toContain('萌萌点获取途径')
    expect(rules).toContain('消费和余额门槛都使用此值。')
    expect(rules).toContain('普通操作目前不会产生暂扣记录')
    expect(constants).toContain('管理员不受此余额门槛限制')
  })

  it('keeps related user-facing copy aligned with the ledger rules', async () => {
    const [profile, topBar, rating, resource, resourceCreate, username, chat] =
      await Promise.all([
        readFile('components/user/Profile.tsx', 'utf8'),
        readFile('components/kun/top-bar/UserDropdown.tsx', 'utf8'),
        readFile('components/patch/rating/RatingCard.tsx', 'utf8'),
        readFile('components/patch/resource/Resource.tsx', 'utf8'),
        readFile('components/patch/resource/ResourceCreateAction.tsx', 'utf8'),
        readFile('components/settings/user/Username.tsx', 'utf8'),
        readFile('components/user/StartChatButton.tsx', 'utf8')
      ])

    expect(profile).toContain('text-small">总萌萌点</span>')
    expect(topBar).toContain('待结算萌萌点')
    expect(rating).toContain('删除后无法恢复')
    expect(rating).not.toContain('发布评价获得的萌萌点被扣除')
    expect(resource).toContain('发布资源时获得的萌萌点奖励会被收回')
    expect(resourceCreate).toContain('普通用户的可用萌萌点达到 20')
    expect(username).toContain('需要消耗您 30 可用萌萌点')
    expect(chat).toContain('您当前的可用萌萌点')
  })

  it('uses the 明细 terminology across moemoepoint user surfaces', async () => {
    const files = await globby([
      'app/moemoepoint/**/*.{ts,tsx}',
      'app/admin/user/**/moemoepoint/**/*.{ts,tsx}',
      'app/api/moemoepoint/**/*.{ts,tsx}',
      'app/api/user/**/moemoepoint/**/*.{ts,tsx}',
      'components/moemoepoint/**/*.{ts,tsx}',
      'components/admin/user/RenderCell.tsx',
      'constants/routes/constants.ts'
    ])
    const legacyTerm = String.fromCodePoint(0x6d41, 0x6c34)
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (source.includes(legacyTerm)) {
        violations.push(file)
      }
    }

    expect(violations).toEqual([])
  })
})
