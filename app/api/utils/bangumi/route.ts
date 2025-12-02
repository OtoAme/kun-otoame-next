import { NextResponse } from 'next/server'
import { z } from 'zod'

const bangumiSchema = z.object({
    subjectId: z.string().min(1)
})

export async function POST(req: Request) {
    try {
        const json = await req.json()
        const { subjectId } = bangumiSchema.parse(json)

        const headers: HeadersInit = {
            'User-Agent': 'KunGalgame/1.0 (https://github.com/KUN1007/KunGalgame)'
        }

        const accessToken = process.env.BANGUMI_ACCESS_TOKEN
        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`
        }

        const res = await fetch(`https://api.bgm.tv/v0/subjects/${subjectId}`, {
            headers
        })

        if (!res.ok) {
            return NextResponse.json(
                { error: 'Failed to fetch data from Bangumi' },
                { status: res.status }
            )
        }

        const data = await res.json()
        return NextResponse.json(data)
    } catch (error) {
        return NextResponse.json(
            { error: 'Internal Server Error' },
            { status: 500 }
        )
    }
}
