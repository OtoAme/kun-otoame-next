import { describe, expect, it } from 'vitest'
import {
  workspaceEntriesQuerySchema,
  workspaceResourcesQuerySchema,
  workspaceResourceUpdateSchema
} from '~/validations/workspace'

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
