import { NextResponse } from 'next/server'

export const companyMergeJson = (body: unknown) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store' }
  })
