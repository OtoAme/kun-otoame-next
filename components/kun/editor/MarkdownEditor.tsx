'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { Button } from '@heroui/button'
import { Tooltip } from '@heroui/tooltip'
import { useDropzone } from 'react-dropzone'
import {
  Bold,
  Italic,
  Strikethrough,
  Heading,
  Link,
  Image,
  Quote,
  Code,
  List,
  ListOrdered,
  Minus,
  Eye,
  ImageUp,
  PenLine,
  Upload
} from 'lucide-react'
import { cn } from '~/utils/cn'
import { markdownToPreviewHtml } from '~/utils/markdownPreview'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  className?: string
  /**
   * Optional image upload. When given, the toolbar shows an upload button, a
   * drop area sits under the text, and images dropped anywhere on the editor
   * are accepted too. Each uploaded file is inserted as a markdown image at the
   * cursor; the handler returns the image URL or an error message.
   */
  onUploadImage?: (file: File) => Promise<{ url: string } | string>
  uploadAccept?: string
  /** Lets the form hold its submit button until uploads finish. */
  onUploadingChange?: (uploading: boolean) => void
}

interface ToolbarAction {
  icon: typeof Bold
  label: string
  title: string
  prefix: string
  suffix: string
  multiline?: boolean
  placeholder?: string
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    icon: Bold,
    label: 'Bold',
    title: '加粗 (Ctrl+B)',
    prefix: '**',
    suffix: '**'
  },
  {
    icon: Italic,
    label: 'Italic',
    title: '斜体 (Ctrl+I)',
    prefix: '*',
    suffix: '*'
  },
  {
    icon: Strikethrough,
    label: 'Strikethrough',
    title: '删除线',
    prefix: '~~',
    suffix: '~~'
  },
  {
    icon: Heading,
    label: 'Heading',
    title: '插入小标题',
    prefix: '## ',
    suffix: ''
  },
  {
    icon: Link,
    label: 'Link',
    title: '链接 (Ctrl+K)',
    prefix: '[',
    suffix: '](url)',
    placeholder: '链接文字'
  },
  {
    icon: Image,
    label: 'Image',
    title: '外链图片',
    prefix: '![',
    suffix: '](url)',
    placeholder: '图片描述'
  },
  {
    icon: Quote,
    label: 'Quote',
    title: '引用',
    prefix: '> ',
    suffix: ''
  },
  {
    icon: Code,
    label: 'Code',
    title: '代码块',
    prefix: '```\n',
    suffix: '\n```',
    multiline: true,
    placeholder: '代码'
  },
  {
    icon: List,
    label: 'Unordered List',
    title: '无序列表',
    prefix: '- ',
    suffix: ''
  },
  {
    icon: ListOrdered,
    label: 'Ordered List',
    title: '有序列表',
    prefix: '1. ',
    suffix: ''
  },
  {
    icon: Minus,
    label: 'Horizontal Rule',
    title: '分割线',
    prefix: '\n---\n',
    suffix: '',
    placeholder: ''
  }
]

export const KunMarkdownEditor = ({
  value,
  onChange,
  placeholder = '输入 Markdown 内容...',
  minHeight = 200,
  className,
  onUploadImage,
  uploadAccept = 'image/jpeg,image/png,image/webp,image/avif',
  onUploadingChange
}: Props) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [uploading, setUploading] = useState(false)
  const uploadingRef = useRef(false)
  const onUploadingChangeRef = useRef(onUploadingChange)
  onUploadingChangeRef.current = onUploadingChange
  const markUploading = (next: boolean) => {
    uploadingRef.current = next
    setUploading(next)
    onUploadingChangeRef.current?.(next)
  }
  const [uploadError, setUploadError] = useState('')
  const valueRef = useRef(value)
  valueRef.current = value

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!onUploadImage || !files.length) return
      if (uploadingRef.current) {
        setUploadError('上一批图片还在上传，请稍候再添加')
        return
      }
      markUploading(true)
      setUploadError('')
      for (const file of files) {
        const result = await onUploadImage(file).catch(
          () => '网络错误，图片上传失败，请重试'
        )
        if (typeof result === 'string') {
          setUploadError(result || '图片上传失败，请重试')
          break
        }
        const textarea = textareaRef.current
        const current = valueRef.current
        const at = textarea ? textarea.selectionEnd : current.length
        const snippet = `${at > 0 && current[at - 1] !== '\n' ? '\n' : ''}![图片](${result.url})\n`
        const next = current.slice(0, at) + snippet + current.slice(at)
        valueRef.current = next
        onChange(next)
        requestAnimationFrame(() => {
          textarea?.focus()
          textarea?.setSelectionRange(at + snippet.length, at + snippet.length)
        })
      }
      markUploading(false)
    },
    // markUploading only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onUploadImage, onChange]
  )
  const dropAccept = useMemo(
    () =>
      Object.fromEntries(
        uploadAccept
          .split(',')
          .map((type) => type.trim())
          .filter(Boolean)
          .map((type) => [type, [] as string[]])
      ),
    [uploadAccept]
  )
  // The text area stays clickable for typing, so the dropzone only opens the
  // file picker from the upload button and the drop area. It stays enabled
  // while uploading: a disabled dropzone drops its handlers, and the browser
  // would then open a dropped image in place of the page and lose the draft.
  // handleFiles refuses the extra batch instead.
  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFilePicker
  } = useDropzone({
    onDrop: (accepted) => void handleFiles(accepted),
    onDropRejected: () => setUploadError('只能上传 JPG、PNG、WebP、AVIF 图片'),
    accept: dropAccept,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    disabled: !onUploadImage
  })
  useEffect(
    () => () => {
      if (uploadingRef.current) onUploadingChangeRef.current?.(false)
    },
    []
  )
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write')
  const [contentHeight, setContentHeight] = useState(minHeight)
  const previewHtml = useMemo(() => markdownToPreviewHtml(value), [value])

  const insertFormatting = useCallback(
    (action: ToolbarAction) => {
      const textarea = textareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selectedText = value.substring(start, end)
      const hasSelection = start !== end

      let newText: string
      let cursorOffset: number

      if (hasSelection) {
        newText =
          value.substring(0, start) +
          action.prefix +
          selectedText +
          action.suffix +
          value.substring(end)
        cursorOffset =
          start +
          action.prefix.length +
          selectedText.length +
          action.suffix.length
      } else {
        const placeholder = action.placeholder || action.label
        newText =
          value.substring(0, start) +
          action.prefix +
          placeholder +
          action.suffix +
          value.substring(end)
        cursorOffset =
          start +
          action.prefix.length +
          placeholder.length +
          (action.suffix ? 0 : 0)
      }

      onChange(newText)

      requestAnimationFrame(() => {
        textarea.focus()
        if (hasSelection) {
          textarea.setSelectionRange(cursorOffset, cursorOffset)
        } else {
          const selStart = start + action.prefix.length
          const selEnd = selStart + (action.placeholder || action.label).length
          textarea.setSelectionRange(selStart, selEnd)
        }
      })
    },
    [value, onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isMod = e.metaKey || e.ctrlKey

      if (isMod && e.key === 'b') {
        e.preventDefault()
        insertFormatting(TOOLBAR_ACTIONS[0])
      } else if (isMod && e.key === 'i') {
        e.preventDefault()
        insertFormatting(TOOLBAR_ACTIONS[1])
      } else if (isMod && e.key === 'k') {
        e.preventDefault()
        insertFormatting(TOOLBAR_ACTIONS[4])
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        const textarea = textareaRef.current
        if (!textarea) return
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const newText = value.substring(0, start) + '  ' + value.substring(end)
        onChange(newText)
        requestAnimationFrame(() => {
          textarea.focus()
          textarea.setSelectionRange(start + 2, start + 2)
        })
      }
    },
    [value, onChange, insertFormatting]
  )

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const newHeight = Math.max(minHeight, textarea.scrollHeight)
    textarea.style.height = `${newHeight}px`
    setContentHeight(newHeight)
  }, [minHeight])

  useEffect(() => {
    autoResize()
  }, [value, autoResize])

  const wordCount = useMemo(() => {
    const cleaned = value.replace(/\s/g, '')
    return cleaned.length
  }, [value])

  return (
    <div
      {...(onUploadImage ? getRootProps() : {})}
      className={cn(
        'kun-editor border-default-200 overflow-hidden rounded-xl border bg-content1 transition-colors',
        'focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-200/50',
        isDragActive && 'border-primary ring-2 ring-primary-200/50',
        className
      )}
    >
      {onUploadImage && <input {...getInputProps()} aria-label="选择图片" />}
      {/* Toolbar */}
      <div className="border-default-200 bg-default-50 flex items-center gap-0.5 border-b px-2 py-1.5">
        {TOOLBAR_ACTIONS.map((action) => (
          <Fragment key={action.label}>
            <Tooltip content={action.title} showArrow closeDelay={0} size="sm">
              <Button
                variant="light"
                size="sm"
                isIconOnly
                aria-label={action.title}
                className="text-default-500 hover:text-default-700 hover:bg-default-200 h-8 w-8 min-w-0 rounded-lg transition-colors"
                onPress={() => insertFormatting(action)}
              >
                <action.icon className="size-4" />
              </Button>
            </Tooltip>
            {action.label === 'Image' && onUploadImage && (
              <>
                <Tooltip content="上传图片" showArrow closeDelay={0} size="sm">
                  <Button
                    variant="light"
                    size="sm"
                    isIconOnly
                    aria-label="上传图片"
                    isLoading={uploading}
                    className="text-default-500 hover:text-default-700 hover:bg-default-200 h-8 w-8 min-w-0 rounded-lg transition-colors"
                    onPress={openFilePicker}
                  >
                    <ImageUp className="size-4" />
                  </Button>
                </Tooltip>
              </>
            )}
          </Fragment>
        ))}
      </div>
      {uploadError && (
        <p
          role="alert"
          className="text-danger border-default-200 border-b px-3 py-1 text-xs"
        >
          {uploadError}
        </p>
      )}

      {/* Tab switcher */}
      <div className="border-default-200 flex items-center border-b px-3">
        <button
          type="button"
          onClick={() => setActiveTab('write')}
          className={cn(
            'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            activeTab === 'write'
              ? 'border-primary text-primary'
              : 'border-transparent text-default-500 hover:text-default-700'
          )}
        >
          <PenLine className="size-3.5" />
          编辑
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={cn(
            'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            activeTab === 'preview'
              ? 'border-primary text-primary'
              : 'border-transparent text-default-500 hover:text-default-700'
          )}
        >
          <Eye className="size-3.5" />
          预览
        </button>
      </div>

      {/* Content area */}
      <div className="relative">
        {activeTab === 'write' ? (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="text-default-800 placeholder:text-default-400 w-full resize-none bg-transparent px-4 py-3 text-sm leading-relaxed outline-none"
            style={{ height: `${contentHeight}px` }}
          />
        ) : (
          <div
            className="kun-prose overflow-y-auto px-4 py-3 text-sm"
            style={{ height: `${contentHeight}px` }}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>

      {onUploadImage && activeTab === 'write' && (
        <button
          type="button"
          onClick={openFilePicker}
          disabled={uploading}
          className={cn(
            'border-default-200 text-default-500 hover:text-primary flex w-full items-center justify-center gap-2 border-t border-dashed px-3 py-3 text-xs transition-colors',
            isDragActive && 'bg-primary/10 text-primary',
            uploading && 'cursor-wait opacity-70'
          )}
        >
          <Upload className="size-4" aria-hidden />
          {uploading
            ? '图片上传中…'
            : isDragActive
              ? '松开即可上传'
              : '拖动图片到这里，或点击选择图片'}
        </button>
      )}

      {/* Footer */}
      <div className="border-default-200 bg-default-50 flex items-center justify-between border-t px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-default-400 text-xs font-medium">Markdown</span>
          <span className="text-default-300 text-xs">·</span>
          <span className="text-default-400 text-xs">Ctrl+B 加粗</span>
        </div>
        <span className="text-default-400 text-xs tabular-nums">
          {wordCount} 字
        </span>
      </div>
    </div>
  )
}
