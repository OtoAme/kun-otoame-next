import { kunMoyuMoe } from '~/config/moyu-moe'
import type { Metadata } from 'next'
import type { CompanyDetail } from '~/types/api/company'

export const generateKunMetadataTemplate = (
  company: CompanyDetail
): Metadata => {
  return {
    title: `所属会社为 ${company.name} 的 OtomeGame`,
    description: company.introduction,
    openGraph: {
      title: `所属会社为 ${company.name} 的 OtomeGame`,
      description: company.introduction,
      type: 'website',
      images: [company.logo]
    },
    twitter: {
      card: 'summary_large_image',
      title: `所属会社为 ${company.name} 的 OtomeGame`,
      description: company.introduction,
      images: [company.logo]
    },
  }
