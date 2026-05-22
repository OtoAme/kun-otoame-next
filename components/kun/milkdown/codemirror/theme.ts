import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

const hslVar = (token: string, alpha?: number) =>
  alpha == null ? `hsl(var(${token}))` : `hsl(var(${token}) / ${alpha})`

// Enhanced color palette with NextUI tokens
const colors = {
  primary: hslVar('--heroui-primary-500'),
  primaryLight: hslVar('--heroui-primary-400'),
  primaryDark: hslVar('--heroui-primary-600'),
  secondary: hslVar('--heroui-secondary-500'),
  secondaryLight: hslVar('--heroui-secondary-400'),
  success: hslVar('--heroui-success-500'),
  successLight: hslVar('--heroui-success-400'),
  warning: hslVar('--heroui-warning-500'),
  warningLight: hslVar('--heroui-warning-400'),
  danger: hslVar('--heroui-danger-500'),
  dangerLight: hslVar('--heroui-danger-400'),
  foreground: hslVar('--heroui-foreground'),
  background: hslVar('--heroui-background'),
  backgroundAlpha: hslVar('--heroui-background', 0.7),
  overlay: hslVar('--heroui-default-200'),
  overlayLight: hslVar('--heroui-default-100'),
  divider: hslVar('--heroui-divider'),
  content1: hslVar('--heroui-content1'),
  content2: hslVar('--heroui-content2'),
  content3: hslVar('--heroui-content3'),
  content4: hslVar('--heroui-content4'),
  primaryLightAlpha: hslVar('--heroui-primary-400', 0.31),
  primaryAlpha: hslVar('--heroui-primary-500', 0.25),
  primarySoftAlpha: hslVar('--heroui-primary-500', 0.13),
  content1Alpha: hslVar('--heroui-content1', 0.19),
  warningAlpha: hslVar('--heroui-warning-500', 0.19)
}

export const kunCMTheme = () => {
  return EditorView.theme({
    '&': {
      backgroundColor: colors.backgroundAlpha,
      borderRadius: '0.75rem',
      lineHeight: '1.5',
      scrollbarWidth: 'none',
      minHeight: '256px'
    },

    '&.cm-focused': {
      outline: 'none'
    },

    '.cm-scroller': {
      display: 'block !important',
      lineHeight: '1.5',
      padding: '1rem 0.5rem',
      maxWidth: '100%',
      scrollbarWidth: 'none',
      overflow: 'visible !important',
      '&>.div': {
        maxWidth: '100%'
      }
    },

    '.cm-line': {
      padding: '0',
      borderRadius: '0.375rem',
      maxWidth: '100%',
      whiteSpace: 'pre-wrap',
      '&:hover': {
        backgroundColor: colors.overlayLight
      }
    },

    '&.cm-focused .cm-cursor': {
      borderLeftColor: colors.primary,
      borderLeftWidth: '2px'
    },

    '.cm-panels': {
      backgroundColor: colors.background,
      color: colors.foreground,
      borderRadius: '0.5rem',
      margin: '0.5rem'
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: `1px solid ${colors.divider}`
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: `1px solid ${colors.divider}`
    },

    '.cm-searchMatch': {
      backgroundColor: colors.primaryLightAlpha,
      outline: `1px solid ${colors.primaryLight}`,
      borderRadius: '2px'
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: colors.primaryAlpha
    },

    '.cm-activeLine': {
      backgroundColor: colors.content1Alpha,
      borderRadius: '0.375rem'
    },
    '.cm-selectionMatch': {
      backgroundColor: colors.primarySoftAlpha,
      borderRadius: '2px'
    },

    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: colors.warningAlpha,
      outline: 'none',
      borderRadius: '2px',
      padding: '0 1px',
      fontWeight: '600'
    },

    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '0.5rem',
      fontFamily: 'var(--heroui-fonts-mono)',
      fontSize: '0.85em',
      padding: '0 0.5rem'
    },

    '.cm-lineNumbers': {
      color: colors.content3
    },

    '.cm-foldGutter': {
      color: colors.content3
    },

    '.cm-tooltip': {
      backgroundColor: colors.background,
      border: `1px solid ${colors.divider}`,
      borderRadius: '0.5rem',
      boxShadow:
        '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      overflow: 'hidden'
    },

    '.cm-tooltip-autocomplete': {
      '& > ul': {
        fontFamily: 'var(--heroui-fonts-mono)',
        fontSize: '0.9rem',
        maxHeight: '20rem'
      },
      '& > ul > li': {
        padding: '0.375rem 0.75rem',
        borderRadius: '0.25rem'
      },
      '& > ul > li[aria-selected]': {
        backgroundColor: colors.content1,
        color: colors.foreground
      }
    },

    '&::-webkit-scrollbar': {
      width: '6px',
      height: '6px'
    },
    '&::-webkit-scrollbar-track': {
      background: 'transparent'
    },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: colors.content3,
      borderRadius: '3px',
      '&:hover': {
        backgroundColor: colors.content2
      }
    }
  })
}

export const kunCMHighlightStyle = () =>
  HighlightStyle.define([
    // Keywords and control flow
    { tag: t.keyword, color: colors.primary, fontWeight: '600' },
    { tag: t.controlKeyword, color: colors.primary, fontWeight: '600' },
    { tag: t.moduleKeyword, color: colors.primary, fontWeight: '600' },

    // Variables and properties
    { tag: [t.propertyName, t.macroName], color: colors.secondary },
    { tag: t.variableName, color: colors.foreground },
    {
      tag: t.definition(t.variableName),
      color: colors.secondary,
      fontWeight: '600'
    },

    // Functions
    {
      tag: [t.function(t.variableName), t.labelName],
      color: colors.success,
      fontWeight: '500'
    },
    {
      tag: t.definition(t.function(t.variableName)),
      color: colors.success,
      fontWeight: '600'
    },

    // Types and classes
    {
      tag: [t.typeName, t.className, t.namespace],
      color: colors.warning,
      fontWeight: '500'
    },
    { tag: [t.annotation, t.modifier], color: colors.warningLight },

    // Constants and literals
    {
      tag: [t.number, t.bool, t.null],
      color: colors.secondary,
      fontWeight: '500'
    },
    { tag: t.string, color: colors.success },
    { tag: t.regexp, color: colors.warning },

    // Special syntax
    { tag: [t.meta, t.comment], color: colors.foreground, fontStyle: 'italic' },
    { tag: t.tagName, color: colors.primary, fontWeight: '500' },
    { tag: t.attributeName, color: colors.warning },

    // Markdown specific
    { tag: t.heading, color: colors.primary, fontWeight: '700' },
    {
      tag: [t.url, t.link],
      color: colors.success,
      textDecoration: 'underline'
    },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strong, fontWeight: '700' },

    // Special cases
    {
      tag: t.invalid,
      color: colors.danger,
      borderBottom: `2px dotted ${colors.danger}`
    },
    { tag: t.changed, color: colors.warning },
    { tag: t.inserted, color: colors.success },
    { tag: t.deleted, color: colors.danger }
  ])

export const kunCM = (): Extension => [
  kunCMTheme(),
  syntaxHighlighting(kunCMHighlightStyle())
]
