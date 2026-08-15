'use client'

import { cn } from '~/utils/cn'
import { StickerThumbnail } from '~/components/sticker/StickerThumbnail'
import type {
  PrivateMessageSticker,
  StickerPack
} from '~/types/api/conversation'

interface Props {
  packs: StickerPack[]
  activePackId: number | null
  isLoading: boolean
  error: string | null
  onSelectPack: (packId: number) => void
  onSelectSticker: (sticker: PrivateMessageSticker) => void
  onRetry: () => void
}

export const StickerPicker = ({
  packs,
  activePackId,
  isLoading,
  error,
  onSelectPack,
  onSelectSticker,
  onRetry
}: Props) => {
  const activePack = packs.find((pack) => pack.id === activePackId) ?? packs[0]

  return (
    <div
      role="dialog"
      aria-label="贴纸"
      data-testid="sticker-picker"
      className="absolute bottom-full left-0 z-50 mb-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--kun-chat-menu-border)] bg-[var(--kun-chat-menu-bg)] text-[var(--kun-chat-menu-text)] shadow-xl"
    >
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--kun-chat-panel-border)] p-2">
        {packs.map((pack) => {
          const preview = pack.coverUrl ?? pack.stickers[0]?.thumbnailUrl
          const active = pack.id === activePack?.id

          return (
            <button
              key={pack.id}
              type="button"
              aria-label={`切换到${pack.name}`}
              aria-pressed={active}
              className={cn(
                'flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-transparent bg-[var(--kun-chat-image-tile-bg)] p-1 text-xs transition-colors hover:bg-[var(--kun-chat-menu-item-hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500))]',
                active &&
                  'border-[var(--kun-chat-own-bubble-border)] bg-[var(--kun-chat-menu-item-hover-bg)]'
              )}
              onClick={() => onSelectPack(pack.id)}
            >
              {preview ? (
                <img
                  src={preview}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span aria-hidden="true">☺</span>
              )}
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-sm text-[var(--kun-chat-muted-text)]">
          加载贴纸中...
        </div>
      ) : error ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-[var(--kun-chat-muted-text)]">
          <span>{error}</span>
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[var(--kun-chat-text-primary)] hover:bg-[var(--kun-chat-menu-item-hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500))]"
            onClick={onRetry}
          >
            重试
          </button>
        </div>
      ) : activePack ? (
        <div className="grid max-h-64 grid-cols-5 gap-1 overflow-y-auto p-2 sm:grid-cols-6">
          {activePack.stickers.map((sticker) => {
            return (
              <button
                key={sticker.id}
                type="button"
                aria-label={`发送${sticker.alt || sticker.packName}贴纸`}
                data-testid={`sticker-option-${sticker.id}`}
                className="flex aspect-square min-w-0 items-center justify-center rounded-xl p-1 transition-colors hover:bg-[var(--kun-chat-menu-item-hover-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kun-brand-500))]"
                onClick={() => onSelectSticker(sticker)}
              >
                {sticker.url || sticker.thumbnailUrl ? (
                  <StickerThumbnail
                    src={sticker.url}
                    posterSrc={sticker.thumbnailUrl}
                    mediaType={sticker.mediaType}
                    mime={sticker.mime}
                    alt={sticker.alt || sticker.packName}
                    className="size-full"
                  />
                ) : (
                  <span className="text-xs text-[var(--kun-chat-muted-text)]">
                    不可用
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center text-sm text-[var(--kun-chat-muted-text)]">
          暂无可用贴纸
        </div>
      )}
    </div>
  )
}
