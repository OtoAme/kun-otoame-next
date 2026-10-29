import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'
import { helpSimilarSchema } from '~/validations/help'
import { getSimilarHelpPosts } from '../service'
import { helpJson } from '../response'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, helpSimilarSchema)
  if (typeof input === 'string') return helpJson(input)
  return helpJson(
    await getSimilarHelpPosts(input, await getPatchVisibilityWhere(req))
  )
}
