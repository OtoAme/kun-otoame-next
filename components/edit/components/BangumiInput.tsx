import { useState } from 'react'
import { Input, Button } from '@heroui/react'
import { Search } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
    onTagsFetched: (tags: string[]) => void
}

export const BangumiInput = ({ onTagsFetched }: Props) => {
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)

    const handleFetch = async () => {
        if (!input) return

        let subjectId = input
        // Try to parse URL
        // https://bgm.tv/subject/12345
        const match = input.match(/subject\/(\d+)/)
        if (match) {
            subjectId = match[1]
        } else if (!/^\d+$/.test(input)) {
            toast.error('请输入正确的 Bangumi ID 或链接')
            return
        }

        setLoading(true)
        try {
            const res = await fetch('/api/utils/bangumi', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    subjectId
                })
            })

            if (!res.ok) {
                throw new Error('Fetch failed')
            }

            const data = await res.json()
            if (data.tags && Array.isArray(data.tags)) {
                const tags = data.tags.map((t: any) => t.name)
                onTagsFetched(tags)
                toast.success(`成功获取 ${tags.length} 个标签`)
            } else {
                toast.error('未找到标签信息')
            }
        } catch (e) {
            toast.error('获取失败，请检查 ID 或 Token')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-2">
            <h2 className="text-xl">Bangumi 标签同步 (可选)</h2>
            <div className="flex gap-2">
                <Input
                    label="Bangumi 链接 / ID"
                    placeholder="输入 Bangumi 条目链接或 ID"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="flex-1"
                />
                <Button
                    isIconOnly
                    color="primary"
                    isLoading={loading}
                    onClick={handleFetch}
                    className="h-14 w-14"
                >
                    <Search />
                </Button>
            </div>
        </div>
    )
}
