import { z } from 'zod'
import { NextRequest } from 'next/server'
import type { ZodSchema } from 'zod'

export const kunParseGetQuery = <T extends ZodSchema>(
  req: NextRequest,
  schema: T
): z.infer<T> | string => {
  const { searchParams } = new URL(req.url)
  const queryParams = Object.fromEntries(searchParams.entries())

  const result = schema.safeParse(queryParams)
  if (!result.success) {
    return result.error.message
  }

  return result.data
}

export const kunParsePostBody = async <T extends ZodSchema>(
  req: NextRequest,
  schema: T
): Promise<z.infer<T> | string> => {
  const body = await req.json()

  const result = schema.safeParse(body)
  if (!result.success) {
    return result.error.message
  }

  return result.data
}

export const kunParsePutBody = async <T extends ZodSchema>(
  req: NextRequest,
  schema: T
): Promise<z.infer<T> | string> => {
  const body = await req.json()

  const result = schema.safeParse(body)
  if (!result.success) {
    return result.error.message
  }

  return result.data
}

export const kunParseDeleteQuery = <T extends ZodSchema>(
  req: NextRequest,
  schema: T
): z.infer<T> | string => {
  const { searchParams } = new URL(req.url)

  const queryParams = Object.fromEntries(searchParams.entries())
  const result = schema.safeParse(queryParams)
  if (!result.success) {
    return result.error.message
  }

  return result.data
}

export const kunParseFormData = async <T extends ZodSchema>(
  req: NextRequest,
  schema: T
): Promise<z.infer<T> | string> => {
  const formData = await req.formData()
  const rawData: Record<string, unknown> = {}

  const keys = Array.from(formData.keys())
  const uniqueKeys = new Set(keys)

  for (const key of uniqueKeys) {
    const values = formData.getAll(key)
    if (values.length > 1) {
      rawData[key] = values.map((v) => (v instanceof File ? v : v.toString()))
    } else {
      const value = values[0]
      rawData[key] = value instanceof File ? value : value.toString()
    }
  }

  const result = schema.safeParse(rawData)
  if (!result.success) {
    return result.error.message
  }

  return result.data
}
