import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

type GeminiBody = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
  }>
}

type ResultPayload = {
  title?: unknown
  difficulty?: unknown
  level?: unknown
  score?: unknown
  result?: unknown
  confidence?: unknown
}

function extractText(body: GeminiBody) {
  return body.candidates?.[0]?.content?.parts
    ?.filter(part => !part.thought && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim() ?? ''
}

function parseJson(text: string): ResultPayload | null {
  try {
    const cleaned = text.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim()
    return JSON.parse(cleaned)
  } catch {
    const a = text.indexOf('{')
    const b = text.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try { return JSON.parse(text.slice(a, b + 1)) } catch {}
    }
    return null
  }
}

function normalizeDifficulty(value: unknown) {
  const s = String(value ?? '').trim().toUpperCase()
  const pairs: Array<[RegExp, string]> = [
    [/\b(?:PAST|PST)\b/, 'PST'],
    [/\b(?:PRESENT|PRS)\b/, 'PRS'],
    [/\b(?:FUTURE|FTR)\b/, 'FTR'],
    [/\b(?:BEYOND|BYD)\b/, 'BYD'],
    [/\b(?:ETERNAL|ETR)\b/, 'ETR'],
    [/\b(?:INSCRIBED|INS)\b/, 'INS'],
  ]
  for (const [pattern, code] of pairs) if (pattern.test(s)) return code
  return null
}

function normalizeLevel(levelValue: unknown, difficultyValue: unknown) {
  const direct = String(levelValue ?? '').trim()
  if (/^(?:[1-9]|1[0-2])\+?$/.test(direct)) return direct

  const combined = String(difficultyValue ?? '').toUpperCase()
  const match = combined.match(/(?:^|\s)((?:[1-9]|1[0-2])\+?)(?:\s|$)/)
  return match?.[1] ?? null
}

function normalizeResult(value: unknown) {
  const s = String(value ?? '').trim().toUpperCase()
  if (['L', 'LOST', 'TRACK LOST', 'TRACK LOST / EASY'].includes(s)) return 'L'
  if (['C', 'F', 'P', 'COMPLETE', 'TRACK COMPLETE', 'FULL RECALL', 'PURE MEMORY'].includes(s)) return 'C'
  return null
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim()
    if (!apiKey) return NextResponse.json({ error: '이미지 분석 서버가 준비되지 않았습니다.' }, { status: 503 })

    const form = await request.formData()
    const image = form.get('image')
    if (!(image instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || image.size === 0) {
      return NextResponse.json({ error: 'JPG, PNG, WEBP 이미지만 사용할 수 있습니다.' }, { status: 400 })
    }
    if (image.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: '이미지는 8MB 이하만 사용할 수 있습니다.' }, { status: 413 })
    }

    const bytes = Buffer.from(await image.arrayBuffer())
    const prompt = `This is a single Arcaea play result screen, not an Arcaea Online B50 grid.

Read the play result shown on screen and return JSON only:
{"title":"Swan Song","difficulty":"FTR","level":"9+","score":9719361,"result":"C","confidence":0.99}

Rules:
- title: the song title shown near the upper center. Do not use the artist name.
- difficulty: one of PST, PRS, FTR, BYD, ETR, INS. Convert PAST/PRESENT/FUTURE/BEYOND/ETERNAL/INSCRIBED to those abbreviations. The screen may show text like "FUTURE 9+".
- level: displayed chart level such as 8, 8+, 9, 9+, 10, 10+, 11, 11+, 12. If the screen shows "FUTURE 9+", return difficulty "FTR" and level "9+".
- score: the large current score in the middle. Remove separators. It may be 0 if the play was abandoned immediately. Do NOT use HIGH SCORE, previous score, fragments, memories, or note counts.
- result: "L" only for TRACK LOST. Return "C" for TRACK COMPLETE, FULL RECALL, or PURE MEMORY.
- confidence: 0..1 confidence for title+difficulty+score.
- Ignore account Potential and the Potential change at the top.
- Preserve unusual characters in song titles when readable.`

    const configured = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash'
    const models = [...new Set([configured, 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'])]
    let lastStatus = 502

    for (const model of models) {
      if (!/^[a-zA-Z0-9._-]+$/.test(model)) continue
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(22_000),
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: image.type, data: bytes.toString('base64') } },
                { text: prompt },
              ],
            }],
          }),
        })

        lastStatus = response.status
        if (!response.ok) continue

        const body = await response.json() as GeminiBody
        const parsed = parseJson(extractText(body))
        if (!parsed) continue

        const title = String(parsed.title ?? '').trim().slice(0, 160)
        const difficulty = normalizeDifficulty(parsed.difficulty)
        const level = normalizeLevel(parsed.level, parsed.difficulty)
        const digits = String(parsed.score ?? '').replace(/[^0-9]/g, '')
        const score = digits ? Number(digits) : NaN
        const result = normalizeResult(parsed.result)
        const conf = Number(parsed.confidence)
        const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.6

        if (!title || !difficulty || !Number.isInteger(score) || score < 0 || score > 10_100_000) continue

        return NextResponse.json({
          title,
          difficulty,
          level,
          score,
          result: result ?? 'C',
          confidence,
          meta: { mode: 'single-result' },
        }, { headers: { 'Cache-Control': 'no-store' } })
      } catch (error) {
        if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) lastStatus = 504
      }
    }

    return NextResponse.json(
      { error: lastStatus === 504 ? '결과 화면 분석 시간이 초과됐습니다.' : '결과 화면을 읽지 못했습니다.' },
      { status: lastStatus === 504 ? 504 : 502 },
    )
  } catch (error) {
    console.error('Result import route error:', error)
    return NextResponse.json({ error: '결과 화면 분석 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
