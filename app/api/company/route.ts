import { NextRequest, NextResponse } from 'next/server'
import {
  createCompanySchema,
  getCompanyByIdSchema,
  updateCompanySchema
} from '~/validations/company'
import {
  kunParseGetQuery,
  kunParsePostBody,
  kunParsePutBody
} from '../utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { createCompany, getCompanyById, rewriteCompany } from './service'

export const GET = async (req: NextRequest) => {
  const input = kunParseGetQuery(req, getCompanyByIdSchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const response = await getCompanyById(input)
  return NextResponse.json(response)
}

export const PUT = async (req: NextRequest) => {
  const input = await kunParsePutBody(req, updateCompanySchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }
  if (payload.role < 3) {
    return NextResponse.json('本页面仅管理员可访问')
  }

  const response = await rewriteCompany(input)
  return NextResponse.json(response)
}

export const POST = async (req: NextRequest) => {
  const input = await kunParsePostBody(req, createCompanySchema)
  if (typeof input === 'string') {
    return NextResponse.json(input)
  }

  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return NextResponse.json('用户未登录')
  }
  if (payload.role < 3) {
    return NextResponse.json('本页面仅管理员可访问')
  }

  const response = await createCompany(input, payload.uid)
  return NextResponse.json(response)
}
