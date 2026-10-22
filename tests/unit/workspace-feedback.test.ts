import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { workspaceValidationFeedback } from '~/validations/workspaceFeedback'
import { workspaceResourceUpdateSchema } from '~/validations/workspace'

const link = (id: number) => ({
  id,
  storage: 'user',
  content: 'https://pan.xunlei.com/s/synthetic-only',
  size: '1GB',
  code: '',
  password: '',
  hash: ''
})
const input = () => ({
  name: '资源',
  section: 'galgame',
  note: '',
  type: ['pc', 'row'],
  platform: ['windows'],
  language: ['ja'],
  baseLinks: [
    { id: 2, version: 1 },
    { id: 3, version: 1 }
  ],
  links: [link(2), link(3)]
})
const feedback = (value: unknown) => {
  const result = workspaceResourceUpdateSchema.safeParse(value)
  expect(result.success).toBe(false)
  if (result.success) throw new Error('Expected an actual validation rejection')
  return workspaceValidationFeedback(result.error)
}

describe('C1 safe workspace validation feedback', () => {
  it.each(['storage', 'content', 'size', 'code', 'password', 'hash'])(
    'associates a single missing field on an otherwise complete editable link: %s',
    (key) => {
      const value = input()
      const changed = { ...value.links[0] } as Record<string, unknown>
      delete changed[key]
      const result = feedback({ ...value, links: [changed, value.links[1]] })
      expect(result.fields.map((item) => item.path)).toContain(`links.0.${key}`)
    }
  )

  it('names the second editable size instead of the protected-ref union branch', () => {
    const value = input()
    value.links[1].size = 'SIZE_CANARY'
    const result = feedback(value)
    expect(result.fields).toContainEqual({
      path: 'links.1.size',
      message: expect.stringMatching(/链接 #2.*大小.*MB.*GB/)
    })
    expect(result.message).not.toMatch(/SIZE_CANARY|版本|version/)
  })

  it('preserves editable field paths when invalid types abort every union branch', () => {
    const value = input()
    const result = feedback({
      ...value,
      links: [value.links[0], { ...value.links[1], size: null }]
    })
    expect(result.fields.map((field) => field.path)).toContain('links.1.size')
    expect(result.message).toContain('链接 #2')
    expect(result.message).not.toContain('版本')
  })

  it('keeps classification reasons actionable and associated with actual form names', () => {
    const result = feedback({
      ...input(),
      type: ['mobile'],
      platform: ['windows']
    })
    expect(result.fields.map((field) => field.path)).toEqual(
      expect.arrayContaining(['type', 'platform'])
    )
    expect(result.message).toMatch(/中文支持/)
    expect(result.message).toMatch(/平台/)
  })

  it('never echoes strict unknown keys, submitted enum values or custom exception-like messages', () => {
    const value = input()
    const result = feedback({
      ...value,
      SECRET_KEY_CANARY: 'BODY_CANARY',
      links: [{ id: 2, version: 1, PRIVATE_KEY_CANARY: 'PASSWORD_CANARY' }]
    })
    expect(JSON.stringify(result)).not.toMatch(/CANARY|PRIVATE_KEY|SECRET_KEY/)
    const synthetic = new z.ZodError([
      {
        code: 'custom',
        path: ['links', 0, 'UNTRUSTED_PATH_CANARY'],
        message: 'SQL_PASSWORD_CANARY'
      },
      {
        code: 'invalid_enum_value',
        path: ['section'],
        options: ['ENUM_CANARY'],
        received: 'VALUE_CANARY',
        message: 'RAW_CANARY'
      }
    ])
    expect(JSON.stringify(workspaceValidationFeedback(synthetic))).not.toMatch(
      /CANARY/
    )
  })

  it('keeps protected references strict and reports only a safe known path', () => {
    const result = feedback({
      ...input(),
      links: [{ id: 2, version: 1, secret: 'PRIVATE_CANARY' }]
    })
    expect(result.fields[0].path).toBe('links.0')
    expect(result.message).toMatch(/链接 #1/)
    expect(result.message).not.toMatch(/PRIVATE_CANARY|content|storage|secret/)
  })

  it.each([
    'storage',
    'content',
    'size',
    'code',
    'password',
    'hash',
    'uploadId'
  ])(
    'does not invent missing editable fields for a retention reference plus %s',
    (key) => {
      const result = feedback({
        ...input(),
        links: [{ id: 2, version: 1, [key]: 'VALUE_CANARY' }]
      })
      expect(result.fields).toEqual([
        {
          path: 'links.0',
          message: expect.stringContaining('包含不支持的字段')
        }
      ])
      expect(result.message).not.toMatch(
        /VALUE_CANARY|请填写|存储类型|大小|提取码|解压码|校验值/
      )
    }
  )

  it.each([
    { id: '2', version: 1, field: 'id' },
    { id: 2, version: null, field: 'version' }
  ])(
    'keeps malformed retention metadata on the reference branch: $field',
    ({ id, version, field }) => {
      const result = feedback({
        ...input(),
        links: [
          { id, version, content: 'https://pan.xunlei.com/s/synthetic-only' }
        ]
      })
      expect(result.fields.map((item) => item.path)).toContain(
        `links.0.${field}`
      )
      expect(result.fields.map((item) => item.path)).not.toEqual(
        expect.arrayContaining(['links.0.storage', 'links.0.size'])
      )
      expect(result.message).not.toMatch(/存储类型|大小|提取码|解压码|校验值/)
    }
  )

  it('deduplicates and bounds paths and messages without copying arbitrary metadata', () => {
    const error = new z.ZodError(
      Array.from({ length: 100 }, (_, index) => ({
        code: 'custom' as const,
        path: ['links', index % 10, 'size'],
        message: 'LONG_CANARY'.repeat(1000)
      }))
    )
    const result = workspaceValidationFeedback(error)
    expect(result.fields.length).toBeGreaterThan(0)
    expect(result.fields.length).toBeLessThanOrEqual(8)
    expect(new Set(result.fields.map((field) => field.path)).size).toBe(
      result.fields.length
    )
    expect(result.message.length).toBeLessThanOrEqual(1024)
    expect(result.message).not.toContain('CANARY')
  })

  it('uses a safe shape explanation for a reference without version plus one editable key', () => {
    const result = feedback({
      ...input(),
      links: [{ id: 2, content: 'https://pan.xunlei.com/s/synthetic-only' }]
    })
    expect(result.fields).toEqual([
      { path: 'links.0', message: expect.stringContaining('完整可编辑链接') }
    ])
    expect(result.message).not.toMatch(/存储类型|大小|提取码|解压码|校验值/)
  })
})
