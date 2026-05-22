import type { CSSProperties } from 'react'

interface SemanticTokenDef {
  color: string
  text: string
  bgAlpha?: string
  fg?: string
}

const semanticTokenDefs = {
  'resource-type': {
    color: 'var(--kun-color-resource-type)',
    text: 'var(--kun-color-resource-type-text)',
    fg: 'var(--kun-color-resource-type-fg)',
    bgAlpha: '0.2'
  },
  'resource-language': {
    color: 'var(--kun-color-resource-language)',
    text: 'var(--kun-color-resource-language-text)',
    bgAlpha: '0.2'
  },
  'resource-platform': {
    color: 'var(--kun-color-resource-platform)',
    text: 'var(--kun-color-resource-platform-text)',
    bgAlpha: '0.2'
  },
  'content-sfw': {
    color: 'var(--kun-color-content-sfw)',
    text: 'var(--kun-color-content-sfw-text)',
    bgAlpha: '0.2'
  },
  'content-nsfw': {
    color: 'var(--kun-color-content-nsfw)',
    text: 'var(--kun-color-content-nsfw-text)',
    bgAlpha: '0.2'
  },
  'recommend-strong-yes': {
    color: 'var(--kun-color-recommend-strong-yes)',
    text: 'var(--kun-color-recommend-strong-yes-text)',
    bgAlpha: '0.2'
  },
  'recommend-yes': {
    color: 'var(--kun-color-recommend-yes)',
    text: 'var(--kun-color-recommend-yes-text)',
    bgAlpha: '0.2'
  },
  'recommend-neutral': {
    color: 'var(--kun-color-recommend-neutral)',
    text: 'var(--kun-color-recommend-neutral-text)',
    bgAlpha: '0.4'
  },
  'recommend-no': {
    color: 'var(--kun-color-recommend-no)',
    text: 'var(--kun-color-recommend-no-text)',
    bgAlpha: '0.2'
  },
  'recommend-strong-no': {
    color: 'var(--kun-color-recommend-strong-no)',
    text: 'var(--kun-color-recommend-strong-no-text)',
    bgAlpha: '0.2'
  }
} as const satisfies Record<string, SemanticTokenDef>

export type SemanticToken = keyof typeof semanticTokenDefs

interface SemanticChipOptions {
  variant?: 'flat' | 'solid'
}

export const semanticChipProps = (
  token: SemanticToken,
  options: SemanticChipOptions = {}
) => {
  const { variant = 'flat' } = options
  const def: SemanticTokenDef = semanticTokenDefs[token]

  if (variant === 'solid' && def.fg) {
    return {
      variant: 'solid' as const,
      color: 'default' as const,
      classNames: {
        base: '!bg-[hsl(var(--kun-semantic-color))]',
        content: '!text-[hsl(var(--kun-semantic-color-fg))]'
      },
      style: {
        '--kun-semantic-color': def.color,
        '--kun-semantic-color-fg': def.fg
      } as CSSProperties
    }
  }

  return {
    variant: 'flat' as const,
    color: 'default' as const,
    classNames: {
      base:
        '!bg-[hsl(var(--kun-semantic-color)/var(--kun-semantic-bg-alpha))]',
      content: '!text-[hsl(var(--kun-semantic-color-text))]'
    },
    style: {
      '--kun-semantic-color': def.color,
      '--kun-semantic-color-text': def.text,
      '--kun-semantic-bg-alpha': def.bgAlpha ?? '0.2'
    } as CSSProperties
  }
}
