import { getRequestBrowsingPreferences } from './browsingPreferences'
import type { NextRequest } from 'next/server'

export const getBlockedTagIds = async (req: NextRequest) =>
  (await getRequestBrowsingPreferences(req)).blockedTagIds
