import type { NextRequest } from 'next/server'
import { linkReportSchema } from '~/validations/linkHealth'
import { healthWrite } from '../http'
import { reportLinkWithCheck } from '../../link-check/service'
export const POST = (req: NextRequest) =>
  healthWrite(req, linkReportSchema, reportLinkWithCheck, 1, true)
