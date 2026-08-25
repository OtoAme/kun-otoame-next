'use client'

import { Card, CardBody } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { Info } from '~/components/patch/introduction/Info'
import { PatchOfficialUrl } from '~/components/patch/introduction/OfficialUrl'
import { PatchIntroductionContent } from '~/components/patch/introduction/PatchIntroductionContent'
import { Gallery } from '~/components/patch/gallery/Gallery'
import { semanticChipProps } from '~/utils/semanticColor'
import type { PatchSubmissionPublishPreview } from '~/app/api/patch-submission/publishPreview'
import type { PatchImage, PatchIntroduction } from '~/types/api/patch'

interface Props {
  preview: PatchSubmissionPublishPreview
  /** Draft creation time, shown in the metadata block only for display. */
  createdAt?: string
  /** Forwarded so a modal host can stop dismissing while the lightbox is open. */
  onLightboxOpenChange?: (open: boolean) => void
}

const toGalleryImages = (
  gallery: PatchSubmissionPublishPreview['gallery']
): PatchImage[] =>
  gallery
    .filter((image) => image.imageUrl)
    .map((image, index) => ({
      id: image.id ?? index,
      url: image.imageUrl as string,
      thumbnailUrl: image.thumbnailUrl,
      isNSFW: image.isNSFW
    }))

const toIntroduction = (
  preview: PatchSubmissionPublishPreview,
  createdAt: string
): PatchIntroduction => ({
  vndbId: preview.externalIds.vndbId || null,
  vndbRelationId: preview.externalIds.vndbRelationId || null,
  bangumiId: preview.externalIds.bangumiId
    ? Number(preview.externalIds.bangumiId)
    : null,
  steamId: preview.externalIds.steamId
    ? Number(preview.externalIds.steamId)
    : null,
  dlsiteCode: preview.externalIds.dlsiteCode || null,
  introduction: preview.introductionHtml,
  officialUrl: preview.officialUrl,
  released: preview.released,
  alias: preview.aliases,
  tag: [],
  company: [],
  images: [],
  resourceUpdateTime: createdAt,
  created: createdAt,
  updated: createdAt
})

/**
 * Read-only render of what a submission will publish as, sharing the live detail
 * page's building blocks so preview and reviewer detail look like the real
 * entry. Approval-time interactive pieces — the rating/stat header, edit and
 * download actions, and the tag/company editors bound to a real patch id — are
 * intentionally left out; a submission has no published patch behind them.
 * Tags and companies are shown as read-only chips because only their names
 * exist before approval.
 */
export const PatchSubmissionPreviewView = ({
  preview,
  createdAt,
  onLightboxOpenChange
}: Props) => {
  const galleryImages = toGalleryImages(preview.gallery)
  const introduction = toIntroduction(
    preview,
    createdAt ?? new Date().toISOString()
  )

  return (
    <div className="space-y-4">
      {preview.bannerUrl && (
        <div className="relative aspect-video w-full max-w-2xl overflow-hidden rounded-large bg-default-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.bannerUrl}
            alt={`${preview.name} 封面`}
            className="absolute inset-0 size-full object-cover"
          />
        </div>
      )}

      <h1 className="text-2xl font-medium">{preview.name}</h1>

      <Card className="p-1 sm:p-8">
        <CardBody className="space-y-6 p-4">
          <PatchIntroductionContent html={preview.introductionHtml} />

          <Gallery
            images={galleryImages}
            onLightboxOpenChange={onLightboxOpenChange}
          />

          <div className="mt-4 space-y-4">
            <h2 className="text-2xl font-medium">游戏标签</h2>
            <div className="flex flex-wrap gap-2">
              {preview.tagNames.length ? (
                preview.tagNames.map((tag) => (
                  <Chip key={tag} color="secondary" variant="flat">
                    {tag}
                  </Chip>
                ))
              ) : (
                <Chip>{'这个 OtomeGame 暂时没有标签'}</Chip>
              )}
            </div>
          </div>

          <PatchOfficialUrl url={preview.officialUrl} />

          <div className="mt-4 space-y-4">
            <h2 className="text-2xl font-medium">所属会社</h2>
            <div className="flex flex-wrap gap-2">
              {preview.companyNames.length ? (
                preview.companyNames.map((company) => (
                  <Chip key={company} {...semanticChipProps('company')}>
                    {company}
                  </Chip>
                ))
              ) : (
                <Chip>{'这个 OtomeGame 本体暂未添加所属会社信息'}</Chip>
              )}
            </div>
          </div>

          <Info intro={introduction} />
        </CardBody>
      </Card>
    </div>
  )
}
