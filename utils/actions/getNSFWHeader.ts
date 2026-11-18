'use server'

import { getPageBrowsingPreferences } from './getBrowsingPreferences'
import { getContentLimitWhere } from '~/utils/contentPreference'

export const getNSFWHeader = async () =>
  getContentLimitWhere((await getPageBrowsingPreferences()).mode)
