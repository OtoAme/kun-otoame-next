import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { getBackupDetail } from '~/lib/officialMirror/backupService'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { backupDetailSchema } from '~/validations/officialMirror'

export const GET = async (req: NextRequest) =>
  withMirrorAdmin(req, async () => {
    const input = kunParseGetQuery(req, backupDetailSchema)
    if (typeof input === 'string') return input
    return getBackupDetail(input)
  })
