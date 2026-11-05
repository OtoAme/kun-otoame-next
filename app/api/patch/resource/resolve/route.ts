import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { officialMirrorJson } from '~/lib/officialMirror/http'
import {
  resolveMergedResource,
  type ResolveReader
} from '~/lib/officialMirror/resolve'
import { prisma } from '~/prisma/index'
import { officialMirrorResolveSchema } from '~/validations/officialMirror'

const reader: ResolveReader = {
  $queryRaw: (query) => prisma.$queryRaw(query),
  patch_resource: {
    findFirst: (args) => prisma.patch_resource.findFirst(args)
  }
}

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, officialMirrorResolveSchema)
  if (typeof input === 'string') return officialMirrorJson(input)
  const visibilityWhere = await getPatchVisibilityWhere(req)
  return officialMirrorJson(
    await resolveMergedResource(reader, input.resourceId, visibilityWhere)
  )
}
