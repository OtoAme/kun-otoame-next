import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PatchResource } from '~/types/api/patch'

const prismaMocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn()
  },
  patch_resource: {
    findUnique: vi.fn()
  },
  admin_log: {
    create: vi.fn()
  },
  $transaction: vi.fn((fn: (tx: any) => Promise<unknown>) => fn(prismaMocks))
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

const updatePatchResourceByRoleMock = vi.hoisted(() => vi.fn())

vi.mock('~/app/api/patch/resource/update', () => ({
  updatePatchResource: updatePatchResourceByRoleMock
}))

vi.mock('~/app/api/patch/resource/_helper', () => ({
  sanitizeResourceForAuditLog: (resource: unknown) => resource
}))

const createMessageMock = vi.hoisted(() => vi.fn())

vi.mock('~/app/api/utils/message', () => ({
  createMessage: createMessageMock
}))

import { updatePatchResource } from '~/app/api/admin/resource/update'

const updateInput = {
  resourceId: 10,
  patchId: 20,
  section: 'galgame' as const,
  name: '修正后的资源',
  links: [
    {
      id: 30,
      storage: 'user',
      hash: '',
      content: 'https://example.com/resource',
      size: '1 GB',
      code: '',
      password: ''
    }
  ],
  note: '',
  type: ['game'],
  language: ['ja'],
  platform: ['windows']
}

const originalResource = {
  id: 10,
  name: '原资源',
  section: 'galgame',
  type: ['pc'],
  language: ['ja'],
  note: '原备注',
  platform: ['windows'],
  user_id: 100,
  patch_id: 20,
  links: [
    {
      id: 29,
      storage: 'user',
      hash: 'old-hash',
      content: 'https://secret.example.com/old-resource',
      size: '1 GB',
      code: 'old-code',
      password: 'old-password',
      download: 0,
      sort_order: 0
    },
    {
      id: 30,
      storage: 's3',
      hash: 's3-hash',
      content: 'https://s3.example.com/secret-resource',
      size: '2 GB',
      code: '',
      password: '',
      download: 0,
      sort_order: 1
    }
  ]
}

const updatedResource: PatchResource = {
  id: 10,
  name: '修正后的资源',
  section: 'galgame',
  uniqueId: 'abc12345',
  type: ['mobile', 'chinese'],
  language: ['zh-Hans'],
  note: '新备注',
  platform: ['android'],
  links: [
    {
      id: 30,
      storage: 's3',
      hash: 'new-secret-hash',
      content: 'https://s3.example.com/new-secret-resource',
      size: '3 GB',
      code: 'new-code',
      password: 'new-password',
      sortOrder: 0,
      download: 0
    }
  ],
  download: 0,
  likeCount: 0,
  isLike: false,
  status: 0,
  userId: 100,
  patchId: 20,
  created: '2026-06-28',
  user: {
    id: 100,
    name: '资源作者',
    avatar: '',
    patchCount: 1,
    role: 2
  }
}

describe('admin resource update notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.$transaction.mockImplementation(
      (fn: (tx: typeof prismaMocks) => Promise<unknown>) => fn(prismaMocks)
    )
    prismaMocks.user.findUnique.mockResolvedValue({ id: 3, name: '管理员' })
    prismaMocks.patch_resource.findUnique.mockResolvedValue(originalResource)
    updatePatchResourceByRoleMock.mockResolvedValue(updatedResource)
  })

  it('notifies the resource owner when an admin updates their resource', async () => {
    const result = await updatePatchResource(updateInput, 3)

    expect(result).toEqual(updatedResource)
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system',
        sender_id: 3,
        recipient_id: 100,
        link: '/abc12345'
      }),
      prismaMocks
    )
    const message = createMessageMock.mock.calls[0][0].content
    expect(message).toContain('管理员修改了你发布的游戏资源「修正后的资源」。')
    expect(message).toContain('- 资源名称: 原资源 -> 修正后的资源')
    expect(message).toContain('- 类型: PC游戏 -> 手机游戏、民汉')
    expect(message).toContain('- 语言: 日本語 -> 简体中文')
    expect(message).toContain('- 平台: Windows -> Android')
    expect(message).toContain('- 备注: 原备注 -> 新备注')
    expect(message).toContain(
      '- 资源链接: 2 个链接（自定义链接 (>100MB) 1 个、对象存储 (<100MB, 创作者可用) 1 个） -> 1 个链接（对象存储 (<100MB, 创作者可用) 1 个）'
    )
    expect(message).toContain(
      '- 资源链接 #1: 资源链接已更新、大小 (MB 或 GB): 2 GB -> 3 GB、提取码: 未填写 -> 已填写、解压码: 未填写 -> 已填写、Hash 已更新'
    )
    expect(message).toContain(
      '- 原资源链接 #1: 删除（存储类型: 自定义链接 (>100MB)、大小 (MB 或 GB): 1 GB、资源链接: 已填写、提取码: 已填写、解压码: 已填写、Hash: 已填写）'
    )
    expect(message).not.toContain('https://secret.example.com')
    expect(message).not.toContain('https://s3.example.com')
    expect(message).not.toContain('old-code')
    expect(message).not.toContain('new-code')
    expect(message).not.toContain('old-password')
    expect(message).not.toContain('new-password')
    expect(message).not.toContain('old-hash')
    expect(message).not.toContain('new-secret-hash')
  })

  it('does not notify when an admin updates their own resource', async () => {
    prismaMocks.patch_resource.findUnique.mockResolvedValue({
      ...originalResource,
      user_id: 3
    })
    updatePatchResourceByRoleMock.mockResolvedValue({
      ...updatedResource,
      userId: 3,
      user: {
        ...updatedResource.user,
        id: 3
      }
    })

    await updatePatchResource(updateInput, 3)

    expect(createMessageMock).not.toHaveBeenCalled()
  })

  it('reports resource link changes without leaking link secrets when the safe summary is unchanged', async () => {
    prismaMocks.patch_resource.findUnique.mockResolvedValue({
      ...originalResource,
      links: [
        {
          id: 30,
          storage: 'user',
          hash: 'old-hash',
          content: 'https://secret.example.com/old-resource',
          size: '1 GB',
          code: 'old-code',
          password: 'old-password',
          download: 0,
          sort_order: 0
        }
      ]
    })
    updatePatchResourceByRoleMock.mockResolvedValue({
      ...updatedResource,
      name: originalResource.name,
      type: originalResource.type,
      language: originalResource.language,
      note: originalResource.note,
      platform: originalResource.platform,
      links: [
        {
          id: 30,
          storage: 'user',
          hash: 'new-secret-hash',
          content: 'https://secret.example.com/new-resource',
          size: '1 GB',
          code: 'new-code',
          password: 'new-password',
          sortOrder: 0,
          download: 0
        }
      ]
    })

    await updatePatchResource(updateInput, 3)

    const message = createMessageMock.mock.calls[0][0].content
    expect(message).toContain(
      '- 资源链接 #1: 资源链接已更新、提取码已更新、解压码已更新、Hash 已更新'
    )
    expect(message).not.toContain('https://secret.example.com')
    expect(message).not.toContain('old-code')
    expect(message).not.toContain('new-code')
    expect(message).not.toContain('old-password')
    expect(message).not.toContain('new-password')
    expect(message).not.toContain('old-hash')
    expect(message).not.toContain('new-secret-hash')
  })

  it('does not report resource link changes when only recreated link ids differ', async () => {
    prismaMocks.patch_resource.findUnique.mockResolvedValue({
      ...originalResource,
      links: [
        {
          id: 30,
          storage: 'user',
          hash: 'same-hash',
          content: 'https://secret.example.com/same-resource',
          size: '1 GB',
          code: 'same-code',
          password: 'same-password',
          download: 0,
          sort_order: 0
        }
      ]
    })
    updatePatchResourceByRoleMock.mockResolvedValue({
      ...updatedResource,
      name: originalResource.name,
      type: originalResource.type,
      language: originalResource.language,
      platform: originalResource.platform,
      note: '新备注',
      links: [
        {
          id: 999,
          storage: 'user',
          hash: 'same-hash',
          content: 'https://secret.example.com/same-resource',
          size: '1 GB',
          code: 'same-code',
          password: 'same-password',
          sortOrder: 0,
          download: 0
        }
      ]
    })

    await updatePatchResource(updateInput, 3)

    const message = createMessageMock.mock.calls[0][0].content
    expect(message).toContain('- 备注: 原备注 -> 新备注')
    expect(message).not.toContain('资源链接')
  })
})
