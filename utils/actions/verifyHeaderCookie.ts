'use server'

import { getPageIdentity } from './getSessionIdentity'

export const verifyHeaderCookie = async () => getPageIdentity()
