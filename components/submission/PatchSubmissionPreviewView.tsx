'use client'

import { Card, CardBody } from '@heroui/card'
import { Chip } from '@heroui/chip'
import { Tooltip } from '@heroui/tooltip'
import { Info } from '~/components/patch/introduction/Info'
import { PatchOfficialUrl } from '~/components/patch/introduction/OfficialUrl'
import { PatchIntroductionContent } from '~/components/patch/introduction/PatchIntroductionContent'
import { Gallery } from '~/components/patch/gallery/Gallery'
import { KunImageViewer } from '~/components/kun/image-viewer/ImageViewer'
import { semanticChipProps } from '~/utils/semanticColor'
import {
  GALGAME_AGE_LIMIT_DETAIL,
  GALGAME_AGE_LIMIT_MAP
} from '~/constants/galgame'
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
  // Captured as a const so the narrowing survives into the render-prop closure.
  const bannerUrl = preview.bannerUrl
  // The box shows the cropped 16:9 banner; the lightbox opens the full original
  // when one was kept, matching the create/edit page.
  const bannerLightboxSrc = preview.bannerOriginalUrl ?? bannerUrl

  return (
    <div className="space-y-4">
      {bannerUrl && (
        <KunImageViewer
          images={[
            { src: bannerLightboxSrc ?? bannerUrl, alt: `${preview.name} 封面` }
          ]}
          onOpenChange={onLightboxOpenChange}
        >
          {(openLightbox) => (
            <div
              className="relative aspect-video w-full max-w-2xl cursor-zoom-in overflow-hidden rounded-large bg-default-100"
              onClick={() => openLightbox(0)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bannerUrl}
                alt={`${preview.name} 封面`}
                className="absolute inset-0 size-full object-cover"
              />
            </div>
          )}
        </KunImageViewer>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-medium">{preview.name}</h1>
        <Tooltip content={GALGAME_AGE_LIMIT_DETAIL[preview.contentLimit]}>
          <Chip
            {...semanticChipProps(
              preview.contentLimit === 'sfw' ? 'content-sfw' : 'content-nsfw'
            )}
          >
            {GALGAME_AGE_LIMIT_MAP[preview.contentLimit]}
          </Chip>
        </Tooltip>
      </div>

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
            {preview.companyNeedsReview && (
              <section
                aria-labelledby="submission-company-review-heading"
                className="space-y-1 rounded-medium border border-warning-200 bg-warning-50/50 p-3 dark:bg-warning-100/10"
              >
                <h3
                  id="submission-company-review-heading"
                  className="font-medium text-warning-700 dark:text-warning-400"
                >
                  会社信息需管理员确认
                </h3>
                <p className="text-sm text-default-600">
                  不同来源的会社信息存在同名或别名歧义，审核员会先核对身份；这不表示投稿内容填写错误。
                </p>
              </section>
            )}
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
