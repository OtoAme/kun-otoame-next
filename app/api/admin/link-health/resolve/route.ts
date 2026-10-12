import type { NextRequest } from 'next/server'
import { linkHealthResolveSchema } from '~/validations/linkHealth'
import { healthWrite } from '~/app/api/patch/resource/link/http'
import { mutateLinkHealth } from '~/app/api/patch/resource/link/service'
export const POST = (req: NextRequest) =>
  healthWrite(req, linkHealthResolveSchema, mutateLinkHealth, 3)
