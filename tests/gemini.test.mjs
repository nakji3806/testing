import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateExplanation, GeminiError } from '../lib/gemini.ts'

const input = { imageBase64: 'aW1hZ2U=', mimeType: 'image/png', question: '쉽게 설명해줘', systemPrompt: '수학 선생님' }
const originalFetch = globalThis.fetch
const originalKey = process.env.GEMINI_API_KEY
const originalModel = process.env.GEMINI_MODEL
beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-only-key'
  delete process.env.GEMINI_MODEL
})
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalKey
  if (originalModel === undefined) delete process.env.GEMINI_MODEL
  else process.env.GEMINI_MODEL = originalModel
})

test('sends inline image and server key; returns final text without thought parts', async () => {
  globalThis.fetch = async (url, options) => {
    assert.match(url, /models\/gemini-2.5-flash:generateContent$/)
    assert.ok(!url.includes('test-only-key'))
    assert.equal(options.headers['x-goog-api-key'], 'test-only-key')
    const body = JSON.parse(options.body)
    assert.deepEqual(body.contents[0].parts[0].inlineData, { mimeType: 'image/png', data: 'aW1hZ2U=' })
    assert.match(body.contents[0].parts[1].text, /쉽게 설명해줘/)
    assert.equal(body.systemInstruction.parts[0].text, '수학 선생님')
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [
      { thought: true, text: 'internal' }, { text: '풀이' }, { text: '답: 2' },
    ] } }] })
  }
  assert.equal(await generateExplanation(input), '풀이\n답: 2')
})

test('does not send a request without a key', async () => {
  delete process.env.GEMINI_API_KEY
  globalThis.fetch = async () => assert.fail('should not call provider')
  await assert.rejects(generateExplanation(input), error => error instanceof GeminiError && error.status === 503)
})

test('model override uses a model ID, not an arbitrary URL', async () => {
  process.env.GEMINI_MODEL = ' https://example.com/ '
  globalThis.fetch = async () => assert.fail('should not call provider')
  await assert.rejects(generateExplanation(input), /GEMINI_MODEL/)
})

for (const status of [400, 401, 403, 404, 429, 500]) {
  test(`handles upstream ${status} without leaking its response`, async () => {
    globalThis.fetch = async () => new Response('sensitive upstream body', { status })
    await assert.rejects(generateExplanation(input), error => {
      assert.ok(error instanceof GeminiError)
      assert.ok(!error.message.includes('sensitive'))
      assert.equal(error.status, status === 429 ? 429 : [401, 403, 404].includes(status) ? 503 : 502)
      return true
    })
  })
}

for (const payload of [
  { promptFeedback: { blockReason: 'SAFETY' } },
  { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] },
  { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'partial' }] } }] },
  { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'thought only' }] } }] },
  {},
]) {
  test(`rejects incomplete or blocked results: ${JSON.stringify(payload)}`, async () => {
    globalThis.fetch = async () => Response.json(payload)
    await assert.rejects(generateExplanation(input), GeminiError)
  })
}

test('handles timeout and invalid JSON', async () => {
  globalThis.fetch = async () => { throw new DOMException('deadline', 'TimeoutError') }
  await assert.rejects(generateExplanation(input), error => error.status === 504)
  globalThis.fetch = async () => new Response('<html>bad gateway</html>')
  await assert.rejects(generateExplanation(input), GeminiError)
})
