import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PackStatusCover } from '~/components/admin/stickers/PackStatusCover'

describe('PackStatusCover', () => {
  it('renders a real HeroUI dot badge with an accessible enabled state', () => {
    const html = renderToStaticMarkup(
      <PackStatusCover
        name="可爱猫猫"
        coverUrl="https://cdn.example.com/cat.webp"
        isEnabled
      />
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="可爱猫猫已启用"')
    expect(html).toMatch(/\bw-3\b/)
    expect(html).toMatch(/\bh-3\b/)
    expect(html).toContain('bg-emerald-500')
  })

  it('renders the disabled state as a red dot', () => {
    const html = renderToStaticMarkup(
      <PackStatusCover name="困困熊" coverUrl={null} isEnabled={false} />
    )

    expect(html).toContain('aria-label="困困熊已禁用"')
    expect(html).toContain('bg-red-500')
  })
})
