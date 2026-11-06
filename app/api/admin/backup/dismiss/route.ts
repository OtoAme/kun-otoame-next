import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { dismissRebackup } from '~/lib/officialMirror/backupService'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { backupDismissSchema } from '~/validations/officialMirror'

export const POST = async (req: NextRequest) =>
  withMirrorAdmin(req, async (actorId) => {
    const input = await kunParsePostBody(req, backupDismissSchema)
    if (typeof input === 'string') return input
    return dismissRebackup(input, actorId)
  })
