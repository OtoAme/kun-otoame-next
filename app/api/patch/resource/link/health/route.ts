import type { NextRequest } from 'next/server'
import {
  linkHealthActionSchema,
  linkHealthQuerySchema
} from '~/validations/linkHealth'
import { healthWrite, healthRead } from '../http'
import { mutateLinkHealth } from '../service'
import { listPublisherLinks } from '../read'
export const POST = (req: NextRequest) =>
  healthWrite(req, linkHealthActionSchema, mutateLinkHealth)
export const GET = (req: NextRequest) =>
  healthRead(req, linkHealthQuerySchema, listPublisherLinks)
