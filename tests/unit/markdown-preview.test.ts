import { describe, expect, it } from 'vitest'
import { markdownToPreviewHtml } from '~/utils/markdownPreview'

describe('markdownToPreviewHtml', () => {
  it('renders single newlines as hard breaks in plain paragraphs', () => {
    const html = markdownToPreviewHtml('第一行\n第二行')

    expect(html).toMatch(/<p>第一行<br>第二行<\/p>/)
  })
})
