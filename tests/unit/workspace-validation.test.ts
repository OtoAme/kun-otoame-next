import { describe, expect, it } from 'vitest'
import {
  workspaceEntriesQuerySchema,
  workspaceResourcesQuerySchema,
  workspaceResourceUpdateSchema
} from '~/validations/workspace'
import { workspaceValidationFeedback } from '~/validations/workspaceFeedback'

const input = () => ({
  name: '资源',
  section: 'galgame',
  note: '',
  type: ['pc', 'row'],
  language: ['ja'],
  platform: ['windows'],
  baseLinks: [{ id: 2, version: 1 }],
  links: [{ id: 2, version: 1 }]
})
describe('workspace trusted input', () => {
  const editable = () => ({
    ...input(),
    links: [
      {
        id: 2,
        storage: 'user',
        content: 'https://pan.xunlei.com/s/SYNTHETIC_ONLY',
        size: '1GB',
        code: '',
        password: '',
        hash: ''
      }
    ]
  })
  it.each([107, 108, 109])(
    'matches persisted size varchar107 at total length %s',
    (length) => {
      const value = editable()
      value.links[0].size = '1'.repeat(length - 2) + 'MB'
      expect(workspaceResourceUpdateSchema.safeParse(value).success).toBe(
        length <= 107
      )
    }
  )
  it.each(['name', 'note', 'content', 'size', 'code', 'password', 'hash'])(
    'rejects PostgreSQL-unpersistable NUL in resource field %s with safe feedback',
    (field) => {
      const value = editable()
      const text = field === 'size' ? '1\u0000MB' : 'X\u0000Y'
      if (field === 'name' || field === 'note') value[field] = text
      else (value.links[0] as Record<string, unknown>)[field] = text
      const result = workspaceResourceUpdateSchema.safeParse(value)
      expect(result.success).toBe(false)
      if (!result.success) {
        const feedback = workspaceValidationFeedback(result.error)
        expect(feedback.fields.map((item) => item.path)).toContain(
          field === 'name' || field === 'note' ? field : `links.0.${field}`
        )
        expect(feedback.message).toContain('不能包含空字符')
        expect(feedback.message).not.toContain(text)
      }
    }
  )
  it('preserves valid Unicode, ordinary newlines and MB/GB syntax', () => {
    const value = editable()
    value.name = '日本語😀'
    value.note = '合成\n说明'
    value.links[0].password = ' a\n b '
    for (const size of ['1MB', '1.2GB', '1 GB', 'MB']) {
      value.links[0].size = size
      expect(workspaceResourceUpdateSchema.safeParse(value).success).toBe(true)
    }
  })

  it('defaults and trims private list queries', () => {
    expect(workspaceResourcesQuerySchema.parse({ query: '  游戏  ' })).toEqual({
      page: 1,
      limit: 20,
      query: '游戏',
      status: 'all',
      section: 'all'
    })
    expect(
      workspaceEntriesQuerySchema.safeParse({
        view: 'published',
        status: 'draft'
      }).success
    ).toBe(false)
    expect(workspaceResourcesQuerySchema.safeParse({ uid: 99 }).success).toBe(
      false
    )
  })
  it.each([
    'content',
    'code',
    'password',
    'hash',
    'storage',
    'sortOrder',
    'role',
    'uploadId'
  ])('rejects every extra protected-ref key including %s', (key) => {
    const data = input()
    expect(
      workspaceResourceUpdateSchema.safeParse({
        ...data,
        links: [{ ...data.links[0], [key]: '' }]
      }).success
    ).toBe(false)
  })
  it('rejects spoofed identity, target and incomplete/foreign/duplicate link bases', () => {
    expect(workspaceResourceUpdateSchema.parse(input()).links).toEqual([
      { id: 2, version: 1 }
    ])
    for (const key of ['uid', 'role', 'status', 'patchId', 'resourceId'])
      expect(
        workspaceResourceUpdateSchema.safeParse({ ...input(), [key]: 1 })
          .success
      ).toBe(false)
    expect(
      workspaceResourceUpdateSchema.safeParse({
        ...input(),
        links: [{ id: 3, version: 1 }]
      }).success
    ).toBe(false)
    expect(
      workspaceResourceUpdateSchema.safeParse({
        ...input(),
        baseLinks: [{ id: 2, version: 1, code: '' }]
      }).success
    ).toBe(false)
  })
})
