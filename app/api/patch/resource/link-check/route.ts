import type { NextRequest } from 'next/server'
import { linkCheckRequestSchema } from '~/validations/linkHealth'
import { healthWrite } from '../link/http'
import { manualLinkCheck } from './service'
export const POST = (req: NextRequest) =>
  healthWrite(req, linkCheckRequestSchema, manualLinkCheck)
