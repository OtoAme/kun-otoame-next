import { z } from 'zod'
import { prisma } from '~/prisma'
import {
  createCompanySchema,
  getCompanyByIdSchema,
  updateCompanySchema
} from '~/validations/company'

export const getCompanyById = async (
  input: z.infer<typeof getCompanyByIdSchema>
) => {
  const { companyId } = input

  const company = await prisma.patch_company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      count: true,
      alias: true,
      introduction: true,
      primary_language: true,
      official_website: true,
      parent_brand: true,
      created: true,
      user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  })
  if (!company) {
    return '未找到公司'
  }

  return company
}

export const rewriteCompany = async (
  input: z.infer<typeof updateCompanySchema>
) => {
  const {
    companyId,
    name,
    primary_language,
    introduction = '',
    alias = [],
    official_website = [],
    parent_brand = []
  } = input

  const existingCompany = await prisma.patch_company.findFirst({
    where: {
      OR: [{ name }, { alias: { has: name } }]
    }
  })
  if (existingCompany && existingCompany.id !== companyId) {
    return '这个会社已经存在了'
  }

  const newCompany = await prisma.patch_company.update({
    where: { id: companyId },
    data: {
      name,
      introduction,
      alias,
      primary_language,
      official_website,
      parent_brand
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  })

  return newCompany
}

export const createCompany = async (
  input: z.infer<typeof createCompanySchema>,
  uid: number
) => {
  const {
    name,
    primary_language,
    introduction = '',
    alias = [],
    official_website = [],
    parent_brand = []
  } = input

  const existingCompany = await prisma.patch_company.findFirst({
    where: {
      OR: [{ name }, { alias: { has: name } }]
    }
  })
  if (existingCompany) {
    return '这个会社已经存在了'
  }

  const newCompany = await prisma.patch_company.create({
    data: {
      user_id: uid,
      name,
      introduction,
      alias,
      primary_language,
      official_website,
      parent_brand
    },
    select: {
      id: true,
      name: true,
      count: true,
      alias: true
    }
  })

  return newCompany
}
