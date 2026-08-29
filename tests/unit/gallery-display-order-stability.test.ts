import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `display_order` carries no unique constraint, so two rows sharing a value
 * leave their relative order up to the database and the same gallery can render
 * differently between two requests. Every read of a gallery therefore has to
 * break the tie on the stable id, and this file pins that on the reads that
 * render a published entry.
 */
const prismaMocks = vi.hoisted(() => ({
  patch: {
    findUnique: vi.fn()
  }
}))
vi.mock('~/prisma/index', () => ({ prisma: prismaMocks }))

vi.mock('~/lib/redis', () => ({
  getKv: vi.fn().mockResolvedValue(null),
  setKv: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('~/app/api/utils/render/markdownToHtmlExtend', () => ({
  markdownToHtmlExtend: vi.fn().mockResolvedValue('<p />')
}))

import {
  getPatchIntroductionContentByUniqueId,
  getPatchPageContentByUniqueId
} from '~/app/api/patch/_queries'
import { getPatchIntroduction } from '~/app/api/patch/introduction/service'

const stableOrderBy = [{ display_order: 'asc' }, { id: 'asc' }]

const lastImagesOrderBy = () => {
  const args = prismaMocks.patch.findUnique.mock.calls.at(-1)?.[0] as {
    select?: { images: { orderBy: unknown } }
    include?: { images: { orderBy: unknown } }
  }
  return (args.select ?? args.include)?.images.orderBy
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMocks.patch.findUnique.mockResolvedValue(null)
})

describe('published gallery reads', () => {
  it.each([
    ['introduction content', getPatchIntroductionContentByUniqueId],
    ['page content', getPatchPageContentByUniqueId]
  ])('breaks %s ties on the stable id', async (_label, read) => {
    await read('abcd1234')

    expect(lastImagesOrderBy()).toEqual(stableOrderBy)
  })

  it('breaks the introduction endpoint ties on the stable id', async () => {
    await getPatchIntroduction({ uniqueId: 'abcd1234' })

    expect(lastImagesOrderBy()).toEqual(stableOrderBy)
  })
})
