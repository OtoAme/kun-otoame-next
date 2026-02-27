import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { prisma } from '~/prisma/index'
import { duplicateSchema } from '~/validations/edit'

export const duplicate = async (input: z.infer<typeof duplicateSchema>) => {
  const vndbId = input.vndbId?.toLowerCase()
  const vndbRelationId = input.vndbRelationId?.toLowerCase()
  const dlsiteCode = input.dlsiteCode?.toUpperCase()
  const title = input.title

  const matchedFields: string[] = []
  const duplicates: { uniqueId: string; name: string }[] = []
  const seenIds = new Set<string>()

  const addResult = (uniqueId: string, name: string) => {
    if (!seenIds.has(uniqueId)) {
      seenIds.add(uniqueId)
      duplicates.push({ uniqueId, name })
    }
  }

  // vndbRelationId: strict, cannot repeat
  if (vndbRelationId) {
    const patch = await prisma.patch.findFirst({
      where: { vndb_relation_id: vndbRelationId },
      select: { unique_id: true, name: true }
    })
    if (patch) {
      matchedFields.push('vndbRelationId')
      addResult(patch.unique_id, patch.name)
    }
  }

  // dlsiteCode: strict, cannot repeat
  if (dlsiteCode) {
    const patch = await prisma.patch.findFirst({
      where: { dlsite_code: dlsiteCode },
      select: { unique_id: true, name: true }
    })
    if (patch) {
      matchedFields.push('dlsiteCode')
      addResult(patch.unique_id, patch.name)
    }
  }

  // vndbId: soft, can repeat — return ALL matches
  if (vndbId) {
    const patches = await prisma.patch.findMany({
      where: { vndb_id: vndbId },
      select: { unique_id: true, name: true },
      take: 20
    })
    if (patches.length > 0) {
      matchedFields.push('vndbId')
      for (const p of patches) {
        addResult(p.unique_id, p.name)
      }
    }
  }

  // title / alias match
  if (title) {
    const patch = await prisma.patch.findFirst({
      where: {
        OR: [
          { name: { equals: title, mode: 'insensitive' } },
          {
            alias: {
              some: { name: { equals: title, mode: 'insensitive' } }
            }
          }
        ]
      },
      select: { unique_id: true, name: true }
    })
    if (patch) {
      matchedFields.push('title')
      addResult(patch.unique_id, patch.name)
    }
  }

  if (duplicates.length > 0) {
    return {
      uniqueId: duplicates[0].uniqueId,
      matchedFields,
      duplicates
    }
  }

  return {}
}

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, duplicateSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await duplicate(input)
  return NextResponse.json(response)
}
