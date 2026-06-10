import { describe, expect, it } from 'vitest'
import { markdownToHtml as markdownToHtmlStandard } from '~/app/api/utils/render/markdownToHtml'
import { markdownToHtmlComment } from '~/app/api/utils/render/markdownToHtmlComment'
import { markdownToHtmlExtend } from '~/app/api/utils/render/markdownToHtmlExtend'
import { markdownToHtml as markdownToResourceHtml } from '~/components/patch/resource/kun/markdownToHtml'

const singleLineBreakMarkdown = '第一行\n第二行'
const singleLineBreakHtmlPattern = /第一行<br>\s*第二行/

describe('markdown render line breaks', () => {
  it('renders single newlines as hard breaks in standard markdown', async () => {
    const html = await markdownToHtmlStandard(singleLineBreakMarkdown)

    expect(html).toMatch(singleLineBreakHtmlPattern)
  })

  it('renders single newlines as hard breaks in extended markdown', async () => {
    const html = await markdownToHtmlExtend(singleLineBreakMarkdown)

    expect(html).toMatch(singleLineBreakHtmlPattern)
  })

  it('renders single newlines as hard breaks in comments', async () => {
    const html = await markdownToHtmlComment(singleLineBreakMarkdown)

    expect(html).toMatch(singleLineBreakHtmlPattern)
  })

  it('keeps single newline hard breaks in resource notes', async () => {
    const html = await markdownToResourceHtml(singleLineBreakMarkdown)

    expect(html).toMatch(singleLineBreakHtmlPattern)
  })
})
