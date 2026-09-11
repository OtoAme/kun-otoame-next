import { NextResponse } from 'next/server'

export const inboxJson = (body: unknown) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store' }
  })
