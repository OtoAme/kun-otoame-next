import { NextResponse } from 'next/server'

/** Help responses depend on the reader and must never be shared-cached. */
export const helpJson = (body: unknown) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store' }
  })
