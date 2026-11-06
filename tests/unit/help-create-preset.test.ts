import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { resolveHelpCreatePreset } from '~/app/(site)/help/create/preset'

globalThis.React = React

type PatchRow = { id: number; unique_id: string; name: string }
type LiveResource = { status: number; patch_id: number }
type Survivor = {
  id: number
  patch_id: number
  section: string
  patch: { unique_id: string }
}

const state = vi.hoisted(() => ({
  user: null as { uid: number; role: number } | null,
  visibility: {} as Prisma.patchWhereInput
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }
}))

vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: () => Promise.resolve(state.user)
}))

vi.mock('~/utils/actions/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: () => Promise.resolve(state.visibility)
}))

vi.mock('~/components/kun/BreadcrumbTitle', () => ({
  KunBreadcrumbTitle: () => null
}))

vi.mock('~/components/help/HelpPostForm', () => ({
  HelpPostForm: () => null
}))

const patches = new Map<string, PatchRow>()
const resources = new Map<number, LiveResource>()
const survivors = new Map<number, number>()
const survivorRows = new Map<number, Survivor>()
let queries = 0
const patchWheres: Prisma.patchWhereInput[] = []

const reset = () => {
  patches.clear()
  resources.clear()
  survivors.clear()
  survivorRows.clear()
  queries = 0
  patchWheres.length = 0
  state.user = { uid: 1, role: 1 }
  state.visibility = { content_limit: 'sfw' }
}

const db = {
  $queryRaw: async (_query: Prisma.Sql) => {
    queries += 1
    const survivor = [...survivors.entries()][0]
    return survivor ? [{ user_resource_id: survivor[1] }] : []
  },
  patch: {
    findFirst: async (args: {
      where: Prisma.patchWhereInput
      select: { id: true; unique_id: true; name: true }
    }) => {
      patchWheres.push(args.where)
      if (typeof args.where.unique_id === 'string') {
        return patches.get(`unique:${args.where.unique_id}`) ?? null
      }
      if (typeof args.where.id === 'number') {
        return patches.get(`id:${args.where.id}`) ?? null
      }
      return null
    }
  },
  patch_resource: {
    findUnique: async (args: {
      where: { id: number }
      select: { status: true; patch_id: true }
    }) => resources.get(args.where.id) ?? null,
    findFirst: async (args: {
      where: Prisma.patch_resourceWhereInput
      select: {
        id: true
        patch_id: true
        section: true
        patch: { select: { unique_id: true } }
      }
    }) => {
      const id = args.where.id
      return typeof id === 'number' ? (survivorRows.get(id) ?? null) : null
    }
  }
}

const preset = (
  patchUniqueId: string,
  resourceRaw: string,
  visibilityWhere: Prisma.patchWhereInput = { content_limit: 'sfw' }
) =>
  resolveHelpCreatePreset(db, {
    patchUniqueId,
    resourceRaw,
    visibilityWhere
  })

beforeEach(() => {
  reset()
})

describe('help create old resource preset', () => {
  it('prefills a public card on the requested game without a merge lookup', async () => {
    patches.set('unique:abcd1234', { id: 3, unique_id: 'abcd1234', name: '当前游戏' })
    resources.set(8, { status: 0, patch_id: 3 })

    const result = await preset('abcd1234', '8')

    expect(result).toEqual({
      presetPatch: { id: 3, uniqueId: 'abcd1234', name: '当前游戏' },
      presetResourceId: 8
    })
    expect(queries).toBe(0)
    expect(patchWheres[0]).toMatchObject({ unique_id: 'abcd1234', status: 0, content_limit: 'sfw' })
  })

  it('prefills the survivor when the old card is gone', async () => {
    patches.set('unique:abcd1234', { id: 3, unique_id: 'abcd1234', name: '当前游戏' })
    survivors.set(8, 9)
    survivorRows.set(9, {
      id: 9,
      patch_id: 3,
      section: 'galgame',
      patch: { unique_id: 'abcd1234' }
    })

    const result = await preset('abcd1234', '8')

    expect(result).toEqual({
      presetPatch: { id: 3, uniqueId: 'abcd1234', name: '当前游戏' },
      presetResourceId: 9
    })
    expect(queries).toBe(1)
  })

  it('prefills the survivor on its current game after a cross-game move', async () => {
    patches.set('unique:aaaaaaaa', { id: 3, unique_id: 'aaaaaaaa', name: '旧游戏' })
    patches.set('id:4', { id: 4, unique_id: 'bbbbbbbb', name: '当前游戏' })
    survivors.set(8, 9)
    survivorRows.set(9, {
      id: 9,
      patch_id: 4,
      section: 'patch',
      patch: { unique_id: 'bbbbbbbb' }
    })

    const result = await preset('aaaaaaaa', '8')

    expect(result).toEqual({
      presetPatch: { id: 4, uniqueId: 'bbbbbbbb', name: '当前游戏' },
      presetResourceId: 9
    })
    expect(patchWheres.at(-1)).toMatchObject({
      id: 4,
      status: 0,
      content_limit: 'sfw'
    })
  })

  it('does not prefill a survivor the current visitor cannot see', async () => {
    patches.set('unique:abcd1234', { id: 3, unique_id: 'abcd1234', name: '可见游戏' })
    survivors.set(8, 9)

    const result = await preset('abcd1234', '8')

    expect(result).toEqual({
      presetPatch: { id: 3, uniqueId: 'abcd1234', name: '可见游戏' },
      presetResourceId: null
    })
    expect(patchWheres.some((where) => where.id === 9)).toBe(false)
  })

  it('does not follow a merge when the requested card still exists', async () => {
    patches.set('unique:abcd1234', { id: 3, unique_id: 'abcd1234', name: '当前游戏' })
    resources.set(8, { status: 1, patch_id: 3 })
    survivors.set(8, 9)

    const hidden = await preset('abcd1234', '8')
    resources.set(8, { status: 0, patch_id: 4 })
    const otherGame = await preset('abcd1234', '8')

    expect(hidden.presetResourceId).toBeNull()
    expect(otherGame.presetResourceId).toBeNull()
    expect(queries).toBe(0)
  })

  it('leaves the resource empty when there is no mapping', async () => {
    patches.set('unique:abcd1234', { id: 3, unique_id: 'abcd1234', name: '当前游戏' })

    const result = await preset('abcd1234', '8')

    expect(result.presetPatch?.id).toBe(3)
    expect(result.presetResourceId).toBeNull()
  })
})

describe('help create page wiring', () => {
  const prismaState = vi.hoisted(() => ({
    patch: null as PatchRow | null,
    resource: null as LiveResource | null
  }))

  vi.mock('~/prisma/index', () => ({
    prisma: {
      $queryRaw: async () => [],
      patch: {
        findFirst: async () => prismaState.patch
      },
      patch_resource: {
        findUnique: async () => prismaState.resource,
        findFirst: async () => null
      }
    }
  }))

  it('sends the visitor visibility and the query into the form', async () => {
    state.user = { uid: 1, role: 1 }
    prismaState.patch = { id: 3, unique_id: 'abcd1234', name: '当前游戏' }
    prismaState.resource = { status: 0, patch_id: 3 }
    const { default: HelpCreatePage } = await import('~/app/(site)/help/create/page')
    const { HelpPostForm } = await import('~/components/help/HelpPostForm')
    const tree = await HelpCreatePage({
      searchParams: Promise.resolve({ patch: 'abcd1234', resource: '8' })
    })
    const forms: Array<{ props?: Record<string, unknown> }> = []
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      const element = node as { type?: unknown; props?: Record<string, unknown> }
      if (element.type === HelpPostForm) forms.push(element)
      walk(element.props?.children)
    }
    walk(tree)
    expect(forms).toHaveLength(1)
    expect(forms[0]?.props).toMatchObject({
      presetPatch: { id: 3, uniqueId: 'abcd1234', name: '当前游戏' },
      presetResourceId: 8
    })
  })

  it('sends a signed-out visitor to login', async () => {
    state.user = null
    const { default: HelpCreatePage } = await import('~/app/(site)/help/create/page')
    await expect(
      HelpCreatePage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('REDIRECT:/login')
  })
})
