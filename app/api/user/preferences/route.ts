import { NextRequest } from 'next/server'
import { preferenceRoute } from '~/lib/accountPreferences/http'

export const GET = (req: NextRequest) => preferenceRoute(req, false)
export const PATCH = (req: NextRequest) => preferenceRoute(req, true)
