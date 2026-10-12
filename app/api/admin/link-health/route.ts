import type { NextRequest } from 'next/server'
import { adminLinkHealthQuerySchema } from '~/validations/linkHealth'
import { healthRead } from '~/app/api/patch/resource/link/http'
import { listAdminLinks } from '~/app/api/patch/resource/link/read'
export const GET = (req: NextRequest) =>
  healthRead(req, adminLinkHealthQuerySchema, listAdminLinks, 3)
