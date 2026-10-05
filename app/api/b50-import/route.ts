import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const SYSTEM_PROMPT = `You are reading an Arcaea Online B50 result screenshot.
The result grid is fixed: 5 columns x 10 rows, ranks 1-50, ordered left-to-right then top-to-bottom.

You will be asked to focus on ONLY one rank range at a time.
For every requested rank, inspect that card carefully and return one object for that rank even if some fields are unreadable.
Use the card POSITION for the rank. Never shift ranks because a card is hard to read.

Return JSON only:
{"entries":[{"rank":1,"title":"Vindication","score":9963797,"potential":11.619,"level":"9","result":"C","confidence":0.98}]}

Rules:
- rank: exact requested rank from grid position
- title: song title at the bottom of that card, or "" if unreadable
- score: integer score with punctuation removed, or null if unreadable
- potential: small POTENTIAL decimal on the left, or null
- level: top-right displayed difficulty such as 8+, 9, 9+, 10, 10+, 11, 11+, 12, or null
- result: bottom-right C/F/P/L when readable, otherwise null
- confidence: 0..1 confidence for title+score
- Do not invent a title from another card.
- Preserve unusual characters when readable.
- Always return an entry for EVERY requested rank.`

type GeminiBody = {
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
  }>
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

type CleanEntry = {
  rank: number
  title: string
  score: number | null
  scoreVerify?: number | null
  potential: number | null
  level: string | null
  result: 'C' | 'F' | 'P' | 'L' | null
  confidence: number
}

function cleanEntry(value: RawEntry, minRank: number, maxRank: number): CleanEntry | null {
  const rank = Number(value.rank)
  if (!Number.isInteger(rank) || rank < minRank || rank > maxRank) return null

  const title = String(value.title ?? '').trim().slice(0, 160)

  const scoreDigits = String(value.score ?? '').replace(/[^0-9]/g, '')
  const scoreNumber = scoreDigits ? Number(scoreDigits) : NaN
  const score = Number.isInteger(scoreNumber) && scoreNumber >= 7_000_000 && scoreNumber <= 10_100_000
    ? scoreNumber
    : null

  const p = Number(value.potential)
  const potential = Number.isFinite(p) && p >= 5 && p <= 15 ? p : null

  const levelRaw = value.level == null ? '' : String(value.level).trim()
  const level = /^(?:[1-9]|1[0-2])\+?$/.test(levelRaw) ? levelRaw : null

  const resultRaw = String(value.result ?? '').trim().toUpperCase()
  const result = (['C', 'F', 'P', 'L'] as const).includes(resultRaw as 'C' | 'F' | 'P' | 'L')
    ? resultRaw as 'C' | 'F' | 'P' | 'L'
    : null

  const conf = Number(value.confidence)
  const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : (title && score ? 0.6 : 0.25)

  return { rank, title, score, potential, level, result, confidence }
}

function extractText(body: GeminiBody) {
  return body.candidates?.[0]?.content?.parts
    ?.filter(part => !part.thought && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim() ?? ''
}

function parseJsonText(text: string): { entries?: RawEntry[] } | null {
  try {
    const cleaned = text
      .replace(/^\`\`\`(?:json)?\s*/i, '')
      .replace(/\s*\`\`\`$/i, '')
      .trim()
    return JSON.parse(cleaned)
  } catch {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try { return JSON.parse(text.slice(first, last + 1)) } catch {}
    }
    return null
  }
}

async function readRange(input: {
  apiKey: string
  model: string
  bytes: Buffer
  mimeType: string
  startRank: number
  endRank: number
}) {
  const startRow = Math.floor((input.startRank - 1) / 5) + 1
  const endRow = Math.floor((input.endRank - 1) / 5) + 1
  const prompt = `${SYSTEM_PROMPT}

Focus ONLY on ranks #${input.startRank}-#${input.endRank}, which are grid rows ${startRow}-${endRow}.
There are exactly ${input.endRank - input.startRank + 1} requested cards.
Read each requested card separately. Return exactly ${input.endRank - input.startRank + 1} entries in rank order.
If a title or score is unclear, keep the rank and use "" or null instead of skipping the card.`

  const models = [...new Set([input.model, 'gemini-3.8-flash', 'gemini-3.5-flash-lite'])]
  let lastStatus = 0
  let lastDetail = ''

  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': input.apiKey,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(35_000),
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: input.mimeType,
                  data: input.bytes.toString('base64'),
                },
              },
              { text: prompt },
            ],
          }],
        }),
      })

      lastStatus = response.status
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        lastDetail = detail.slice(0, 300)
        if ([401, 403, 404, 429, 503].includes(response.status)) continue
        const err = new Error(`Gemini HTTP ${response.status}`)
        ;(err as Error & { status?: number; detail?: string }).status = response.status
        ;(err as Error & { detail?: string }).detail = lastDetail
        throw err
      }

      const body = await response.json() as GeminiBody
      const parsed = parseJsonText(extractText(body))
      const raw = Array.isArray(parsed?.entries) ? parsed!.entries! : []

      const byRank = new Map<number, CleanEntry>()
      for (const item of raw) {
        const clean = cleanEntry(item, input.startRank, input.endRank)
        if (clean) {
          const old = byRank.get(clean.rank)
          if (!old || clean.confidence > old.confidence) byRank.set(clean.rank, clean)
        }
      }

      const entries: CleanEntry[] = []
      for (let rank = input.startRank; rank <= input.endRank; rank++) {
        entries.push(byRank.get(rank) ?? {
          rank,
          title: '',
          score: null,
          potential: null,
          level: null,
          result: null,
          confidence: 0,
        })
      }
      return entries
    } catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        lastStatus = 504
        lastDetail = 'timeout'
        continue
      }
      const status = (error as { status?: number } | undefined)?.status
      if (status) lastStatus = status
      const detail = (error as { detail?: string } | undefined)?.detail
      if (detail) lastDetail = detail
    }
  }

  const error = new Error(`Gemini unavailable ${lastStatus || ''}`.trim())
  ;(error as Error & { status?: number; detail?: string }).status = lastStatus || 502
  ;(error as Error & { detail?: string }).detail = lastDetail
  throw error
}

async function verifyScoreRange(input: {
  apiKey: string
  model: string
  bytes: Buffer
  mimeType: string
  startRank: number
  endRank: number
}) {
  const row = Math.floor((input.startRank - 1) / 5) + 1
  const prompt = `This is an Arcaea Online B50 screenshot with a fixed 5-column x 10-row grid.
Focus ONLY on grid row ${row}, ranks #${input.startRank}-#${input.endRank}.
Read ONLY the large score number near the bottom of each card.
Ignore song title, POTENTIAL, rank text, and difficulty.
The score is normally between 7,000,000 and 10,100,000.
Be extremely careful with each digit, especially 0/6/8/9 and repeated digits.

Return JSON only:
{"scores":[{"rank":${input.startRank},"score":9963797}]}

Return exactly one item for every requested rank. Use null if truly unreadable.`

  const models = [...new Set([input.model, 'gemini-3.8-flash', 'gemini-3.5-flash-lite'])]
  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': input.apiKey,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(22_000),
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: input.mimeType, data: input.bytes.toString('base64') } },
              { text: prompt },
            ],
          }],
        }),
      })
      if (!response.ok) continue
      const body = await response.json() as GeminiBody
      const parsed = parseJsonText(extractText(body)) as { scores?: Array<{ rank?: unknown; score?: unknown }> } | null
      const out = new Map<number, number | null>()
      for (const item of parsed?.scores ?? []) {
        const rank = Number(item.rank)
        if (!Number.isInteger(rank) || rank < input.startRank || rank > input.endRank) continue
        const digits = String(item.score ?? '').replace(/[^0-9]/g, '')
        const n = digits ? Number(digits) : NaN
        out.set(rank, Number.isInteger(n) && n >= 7_000_000 && n <= 10_100_000 ? n : null)
      }
      const result: Array<{ rank: number; score: number | null }> = []
      for (let rank = input.startRank; rank <= input.endRank; rank++) {
        result.push({ rank, score: out.has(rank) ? out.get(rank)! : null })
      }
      return result
    } catch {
      // Try next model.
    }
  }
  return Array.from({ length: input.endRank - input.startRank + 1 }, (_, i) => ({
    rank: input.startRank + i,
    score: null,
  }))
}


export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json({ ok: false, apiKeyPresent: false, error: 'GEMINI_API_KEY missing' }, { status: 503 })
  }

  const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash']
  const checks: Array<{ model: string; status: number; ok: boolean }> = []

  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
        headers: { 'x-goog-api-key': apiKey },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
      checks.push({ model, status: r.status, ok: r.ok })
    } catch {
      checks.push({ model, status: 0, ok: false })
    }
  }

  return NextResponse.json({
    ok: checks.some(x => x.ok),
    apiKeyPresent: true,
    checks,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim()
    if (!apiKey) {
      return NextResponse.json({ error: '이미지 분석 서버가 아직 준비되지 않았어.' }, { status: 503 })
    }

    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash'
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
      return NextResponse.json({ error: '이미지 분석 모델 설정 오류' }, { status: 503 })
    }

    const form = await request.formData()
    const image = form.get('image')
    if (!(image instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || image.size === 0) {
      return NextResponse.json({ error: 'JPG, PNG, WEBP 이미지를 올려줘.' }, { status: 400 })
    }
    if (image.size > 4 * 1024 * 1024) {
      return NextResponse.json({ error: '이미지는 4MB 이하여야 해.' }, { status: 413 })
    }

    const bytes = Buffer.from(await image.arrayBuffer())
    const ranges = [
      [1, 10],
      [11, 20],
      [21, 30],
      [31, 40],
      [41, 50],
    ] as const

    const entries: CleanEntry[] = []
    let failedGroups = 0
    let rateLimited = false
    const failureStatuses: number[] = []

    // Keep concurrency at 2 so Gemini does not reject five full-image
    // vision calls at once on lower request quotas.
    for (let i = 0; i < ranges.length; i += 2) {
      const batch = ranges.slice(i, i + 2)
      const settled = await Promise.allSettled(
        batch.map(([startRank, endRank]) =>
          readRange({
            apiKey,
            model,
            bytes,
            mimeType: image.type,
            startRank,
            endRank,
          }),
        ),
      )

      settled.forEach((result, batchIndex) => {
        const [startRank, endRank] = batch[batchIndex]
        if (result.status === 'fulfilled') {
          entries.push(...result.value)
        } else {
          failedGroups += 1
          const status = (result.reason as { status?: number } | undefined)?.status
          if (status) failureStatuses.push(status)
          if (status === 429) rateLimited = true
          for (let rank = startRank; rank <= endRank; rank++) {
            entries.push({
              rank,
              title: '',
              score: null,
              potential: null,
              level: null,
              result: null,
              confidence: 0,
            })
          }
        }
      })
    }

    entries.sort((a, b) => a.rank - b.rank)

    // Second independent pass: read only the five score numbers in each row.
    // This is intentionally separate from title/POTENTIAL reading so digit errors
    // can be cross-checked on the client against the chart constant + POTENTIAL.
    const scoreRows = Array.from({ length: 10 }, (_, row) => {
      const startRank = row * 5 + 1
      return [startRank, startRank + 4] as const
    })
    for (let i = 0; i < scoreRows.length; i += 3) {
      const batch = scoreRows.slice(i, i + 3)
      const verified = await Promise.all(
        batch.map(([startRank, endRank]) =>
          verifyScoreRange({
            apiKey,
            model,
            bytes,
            mimeType: image.type,
            startRank,
            endRank,
          }),
        ),
      )
      for (const row of verified) {
        for (const item of row) {
          const entry = entries[item.rank - 1]
          if (entry) entry.scoreVerify = item.score
        }
      }
    }

    const readable = entries.filter(x => x.score || x.title).length

    if (failedGroups === ranges.length) {
      return NextResponse.json(
        { error: rateLimited ? 'AI 요청 한도에 걸렸어. 잠깐 뒤 다시 시도해줘.' : '비전 AI 분석 서버가 응답하지 않았어.', statuses: failureStatuses },
        { status: rateLimited ? 429 : 502 },
      )
    }

    return NextResponse.json(
      {
        entries,
        meta: {
          mode: 'vision-batched',
          readable,
          failedGroups,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
      return NextResponse.json({ error: '이미지 분석 시간이 초과됐어. 다시 시도해줘.' }, { status: 504 })
    }
    console.error('B50 import route error:', error)
    return NextResponse.json({ error: '이미지 분석 중 오류가 났어.' }, { status: 500 })
  }
}
