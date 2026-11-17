import { NextRequest } from 'next/server'
import { preferenceRoute } from '~/lib/accountPreferences/http'

export const saveEmailNotice = (req: NextRequest) =>
  preferenceRoute(req, true, 'email-notice')
