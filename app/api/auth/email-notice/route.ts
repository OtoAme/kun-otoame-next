import { NextRequest } from 'next/server'
import { saveEmailNotice } from './service'

export const POST = (req: NextRequest) => saveEmailNotice(req)
