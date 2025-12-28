'use client'

import { useState } from 'react'
import { EyeOff } from 'lucide-react'

interface NSFWMaskProps {
    isVisible: boolean
    onReveal?: () => void
    className?: string
    text?: {
        title?: string
        subtitle?: string
    }
}

/**
 * NSFW 内容遮罩组件
 * 提供统一的 NSFW 内容遮罩样式和动画
 */
export const NSFWMask = ({
    isVisible,
    onReveal,
    className = '',
    text = {
        title: 'NSFW 内容',
        subtitle: '点击查看'
    }
}: NSFWMaskProps) => {
    const [isRemoving, setIsRemoving] = useState(false)

    if (!isVisible) return null

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation() // 防止触发父元素的点击事件

        if (!onReveal) return

        setIsRemoving(true)
        // 使用 setTimeout 允许动画完成后再调用 onReveal
        setTimeout(() => {
            onReveal()
            setIsRemoving(false)
        }, 300)
    }

    return (
        <div
            className={`absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md rounded-lg transition-all duration-300 group-hover:bg-black/40 ${onReveal ? 'cursor-pointer' : ''
                } ${isRemoving ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                } ${className}`}
            onClick={handleClick}
        >
            <EyeOff className="mb-1 size-6 text-white transition-transform duration-200 group-hover:scale-110" />
            <span className="text-xs font-medium text-white">{text.title}</span>
            {onReveal && text.subtitle && (
                <span className="text-[10px] text-white/80">{text.subtitle}</span>
            )}
        </div>
    )
}
