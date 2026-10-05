import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const SYSTEM_PROMPT = `You read a PRE-CROPPED Arcaea Online B50 contact sheet.
It always contains exactly 5 columns x 10 rows. Each enlarged cell corresponds to one rank, left-to-right then top-to-bottom. A black #rank label was added at the upper-left of each cell.

Read each visible card independently. Do not infer a song from neighboring cells and do not invent unreadable text.
Return ONLY valid JSON in this shape:
{"entries":[{"rank":1,"title":"...","score":9963797,"potential":11.619,"level":"9","result":"C","confidence":0.98}]}

Fields:
- rank: 1 through 50 from the added black rank label / cell position
- title: song title printed along the bottom edge of that card
- score: integer score, remove apostrophes/commas
- potential: the small POTENTIAL decimal printed on the left, or null
- level: top-right chart level such as 8+, 9, 9+, 10, 10+, 11, 11+, 12, or null
- result: bottom-right single letter C/F/P/L when readable, otherwise null
- confidence: 0..1 confidence for title + score together

Preserve unusual title characters when readable. If a cell is too unclear, omit that entry instead of guessing.`

type GeminiBody = {
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
  }>
  promptFeedback?: { blockReason?: string }
}

type RawEntry = {
  rank?: unknown
  title?: unknown
  score?: unknown
  potential?: unknown
  level?: unknown
  result?: unknown
  confidence?: unknown
}

function cleanEntry(value: RawEntry) {
  const rank = Number(value.rank)
  const score = Number(String(value.score ?? '').replace(/[^0-9]/g, ''))
  const title = String(value.title ?? '').trim().slice(0, 160)
  const p = Number(value.potential)
  const potential = Number.isFinite(p) && p >= 0 && p <= 30 ? p : null
  const levelRaw = value.level == null ? '' : String(value.level).trim()
  const level = /^(?:[1-9]|1[0-2])\+?$/.test(levelRaw) ? levelRaw : null
  const resultRaw = String(value.result ?? '').trim().toUpperCase()
  const result = ['C', 'F', 'P', 'L'].includes(resultRaw) ? resultRaw : null
  const conf = Number(value.confidence)
  const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.6
  if (!Number.isInteger(rank) || rank < 1 || rank > 50) return null
  if (!title || !Number.isInteger(score) || score < 0 || score > 10_100_000) return null
  return { rank, title, score, potential, level, result, confidence }
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim()
    if (!apiKey) return NextResponse.json({ error: '이미지 분석 서버가 아직 준비되지 않았어.' }, { status: 503 })
    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash'
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) return NextResponse.json({ error: '이미지 분석 모델 설정 오류' }, { status: 503 })

    const form = await request.formData()
    const image = form.get('image')
    if (!(image instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || image.size === 0) {
      return NextResponse.json({ error: 'JPG, PNG, WEBP 이미지를 올려줘.' }, { status: 400 })
    }
    if (image.size > 4 * 1024 * 1024) return NextResponse.json({ error: '이미지는 4MB 이하여야 해.' }, { status: 413 })
    const bytes = Buffer.from(await image.arrayBuffer())

    let upstream: Response
    try {
      upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(50_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: image.type, data: bytes.toString('base64') } },
            { text: 'Extract every readable B50 card in this Arcaea Online image. Return JSON only.' },
          ] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
          },
        }),
      })
    } catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        return NextResponse.json({ error: '이미지 분석 시간이 초과됐어. 다시 시도해줘.' }, { status: 504 })
      }
      return NextResponse.json({ error: '이미지 분석 서버에 연결하지 못했어.' }, { status: 502 })
    }

    if (!upstream.ok) {
      if (upstream.status === 429) return NextResponse.json({ error: '지금 이미지 분석 요청이 많아. 잠깐 뒤 다시 시도해줘.' }, { status: 429 })
      return NextResponse.json({ error: '이미지 분석에 실패했어. 잠시 후 다시 시도해줘.' }, { status: 502 })
    }

    let body: GeminiBody
    try { body = await upstream.json() } catch { return NextResponse.json({ error: '이미지 분석 결과를 읽지 못했어.' }, { status: 502 }) }
    const candidate = body.candidates?.[0]
    const text = candidate?.content?.parts
      ?.filter(part => !part.thought && typeof part.text === 'string')
      .map(part => part.text).join('\n').trim()
    if (!text) return NextResponse.json({ error: '이미지에서 B50 기록을 찾지 못했어.' }, { status: 422 })

    let parsed: { entries?: RawEntry[] }
    try {
      const cleaned = text.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: '이미지는 읽었는데 결과 정리에 실패했어. 다시 시도해줘.' }, { status: 502 })
    }
    const entries = (Array.isArray(parsed.entries) ? parsed.entries : [])
      .map(cleanEntry).filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 50)
    if (!entries.length) return NextResponse.json({ error: '읽을 수 있는 B50 기록이 없었어. 전체 캡처로 다시 올려줘.' }, { status: 422 })
    return NextResponse.json({ entries }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('B50 import route error:', error)
    return NextResponse.json({ error: '이미지 분석 중 오류가 났어.' }, { status: 500 })
  }
}
