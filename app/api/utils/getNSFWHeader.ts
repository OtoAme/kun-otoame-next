import { getContentLimitWhere } from '~/utils/contentPreference'
import { getRequestBrowsingPreferences } from './browsingPreferences'
import type { NextRequest } from 'next/server'

export const getNSFWHeader = async (req: NextRequest) =>
  getContentLimitWhere((await getRequestBrowsingPreferences(req)).mode)
