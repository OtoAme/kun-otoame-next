'use server'

import { getPageBrowsingPreferences } from './getBrowsingPreferences'

export const getBlockedTagIds = async () =>
  (await getPageBrowsingPreferences()).blockedTagIds
