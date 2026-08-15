'use client'

import {
  forwardRef,
  useLayoutEffect,
  useState,
  type CSSProperties
} from 'react'
import { createPortal } from 'react-dom'
import { motion, useIsPresent, useReducedMotion } from 'framer-motion'
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
  portalTarget?: HTMLDivElement | null
  anchorElement?: HTMLElement | null
}

export const StickerPicker = forwardRef<HTMLDivElement, Props>(
  function StickerPicker(
    {
      packs,
      activePackId,
      isLoading,
      error,
      onSelectPack,
      onSelectSticker,
      onRetry,
      portalTarget,
      anchorElement
    },
    ref
  ) {
    const [desktopAnchorRight, setDesktopAnchorRight] = useState(0)
    const isPresent = useIsPresent()
    const shouldReduceMotion = useReducedMotion()
    const activePack =
      packs.find((pack) => pack.id === activePackId) ?? packs[0]
    const isChatViewportLayout = Boolean(portalTarget)

    useLayoutEffect(() => {
      if (!portalTarget || !anchorElement) {
        return
      }

      const updateAnchor = () => {
        const portalRect = portalTarget.getBoundingClientRect()
        const anchorRect = anchorElement.getBoundingClientRect()
        const nextRight = Math.max(0, portalRect.right - anchorRect.right)

        setDesktopAnchorRight((current) =>
          current === nextRight ? current : nextRight
        )
      }

      updateAnchor()
      window.addEventListener('resize', updateAnchor)
      window.visualViewport?.addEventListener('resize', updateAnchor)

      const resizeObserver =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(updateAnchor)
      resizeObserver?.observe(portalTarget)
      resizeObserver?.observe(anchorElement)

      return () => {
        window.removeEventListener('resize', updateAnchor)
        window.visualViewport?.removeEventListener('resize', updateAnchor)
        resizeObserver?.disconnect()
      }
    }, [anchorElement, portalTarget])

    const picker = (
      <motion.div
        ref={ref}
        role="dialog"
        aria-label="贴纸"
        data-testid="sticker-picker"
        data-layout={isChatViewportLayout ? 'chat-viewport' : 'trigger'}
        initial={
          shouldReduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={
          shouldReduceMotion
            ? { opacity: 0, transition: { duration: 0 } }
            : {
                opacity: 0,
                transition: {
                  duration: 0.14,
                  ease: [0.4, 0, 1, 1]
                }
              }
        }
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : {
                type: 'spring',
                stiffness: 420,
                damping: 34,
                mass: 0.7
              }
        }
        style={
          isChatViewportLayout
            ? ({
                '--kun-sticker-picker-anchor-right': `${desktopAnchorRight}px`
              } as CSSProperties)
            : undefined
        }
        className={cn(
          'pointer-events-auto z-50 flex min-h-0 origin-bottom flex-col overflow-hidden border border-[var(--kun-chat-menu-border)] bg-[var(--kun-chat-menu-bg)] text-[var(--kun-chat-menu-text)] shadow-xl lg:origin-bottom-right',
          isChatViewportLayout
            ? 'absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:h-1/2 max-lg:w-full max-lg:rounded-none lg:bottom-0 lg:right-[var(--kun-sticker-picker-anchor-right)] lg:max-h-[calc(100%-1rem)] lg:w-3/5 lg:rounded-2xl'
            : 'absolute bottom-full left-0 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl',
          !isPresent && 'pointer-events-none'
        )}
      >
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--kun-chat-panel-border)] p-2">
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
          <div
            className={cn(
              'flex items-center justify-center text-sm text-[var(--kun-chat-muted-text)]',
              isChatViewportLayout
                ? 'max-lg:min-h-0 max-lg:flex-1 lg:h-40'
                : 'h-40'
            )}
          >
            加载贴纸中...
          </div>
        ) : error ? (
          <div
            className={cn(
              'flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-[var(--kun-chat-muted-text)]',
              isChatViewportLayout
                ? 'max-lg:min-h-0 max-lg:flex-1 lg:h-40'
                : 'h-40'
            )}
          >
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
          <div
            className={cn(
              'grid grid-cols-5 gap-1 overflow-y-auto p-2',
              isChatViewportLayout
                ? 'max-lg:min-h-0 max-lg:flex-1 max-lg:content-start lg:max-h-[calc(48cqw_+_1px)]'
                : 'max-h-64'
            )}
          >
            {activePack.stickers.map((sticker) => (
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
            ))}
          </div>
        ) : (
          <div
            className={cn(
              'flex items-center justify-center text-sm text-[var(--kun-chat-muted-text)]',
              isChatViewportLayout
                ? 'max-lg:min-h-0 max-lg:flex-1 lg:h-40'
                : 'h-40'
            )}
          >
            暂无可用贴纸
          </div>
        )}
      </motion.div>
    )

    return portalTarget ? createPortal(picker, portalTarget) : picker
  }
)
