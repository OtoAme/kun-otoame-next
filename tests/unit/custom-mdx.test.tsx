import React from 'react'
import { describe, expect, it } from 'vitest'
import remarkBreaks from 'remark-breaks'
import { CustomMDX } from '~/lib/mdx/CustomMDX'
import type { ReactElement } from 'react'

globalThis.React = React

describe('CustomMDX', () => {
  it('enables single newline hard breaks for document markdown', () => {
    const element = CustomMDX({
      source: '第一行\n第二行'
    }) as ReactElement<{
      options?: { mdxOptions?: { remarkPlugins?: unknown[] } }
    }>

    expect(element.props.options?.mdxOptions?.remarkPlugins).toContain(
      remarkBreaks
    )
  })
})
