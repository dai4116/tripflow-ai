import Anthropic from '@anthropic-ai/sdk'

// Vercel's default Node function duration (10s) is too tight for a cold
// start + first-use structured-output schema compilation + generation time
// combined — extend it to match the client's 30s timeout in aiTripClient.ts.
export const config = { maxDuration: 30 }

// Loosely typed on purpose — Vercel's Node runtime augments these at runtime
// (req.body parsing, res.status/json helpers) without needing @vercel/node's
// type package, which pulls in a large, vulnerability-flagged dependency
// tree just for this one small function.
type VercelLikeRequest = {
  method?: string
  body?: unknown
  // Real Node IncomingMessage method — used to detect the client giving up
  // (e.g. aiTripClient.ts's own timeout) so we can cancel the in-flight
  // Claude call instead of paying for tokens nobody will read the result of.
  on?: (event: 'close', listener: () => void) => void
}
type VercelLikeResponse = {
  status: (code: number) => VercelLikeResponse
  json: (body: unknown) => void
}

const PLACE_CATEGORIES = [
  'food',
  'cafe',
  'shopping',
  'culture',
  'nature',
  'museum',
  'transport',
  'stay',
  'activity',
  'other',
] as const

const PLACE_SCHEMA = {
  type: 'object',
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: PLACE_CATEGORIES },
          name: { type: 'string' },
          description: { type: 'string' },
          travelTip: { type: 'string' },
        },
        required: ['category', 'name', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['places'],
  additionalProperties: false,
}

type GenerateTripBody = {
  destination?: string
  travelStyle?: string
  preferences?: string[]
  avoidPlaces?: string
  placeCount?: number
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'AI generation not configured' })
    return
  }

  const { destination, travelStyle, preferences, avoidPlaces, placeCount } = (req.body ?? {}) as GenerateTripBody

  if (!destination || !placeCount || placeCount < 1) {
    res.status(400).json({ error: 'Missing destination or placeCount' })
    return
  }

  const prompt = [
    `目的地：${destination}`,
    `旅遊風格：${travelStyle || '文化'}`,
    preferences?.length ? `興趣偏好：${preferences.join('、')}` : '',
    avoidPlaces ? `想避開：${avoidPlaces}` : '',
    '',
    `請推薦恰好 ${placeCount} 個適合這趟旅程的景點，依建議造訪順序排列，涵蓋不同類型（美食、文化、自然、購物、活動等）。`,
    '每個景點包含分類、名稱、一句簡短描述（繁體中文），以及可選的一句實用小提示（travelTip）。',
    '不要編造具體的評分、地址或經緯度——只需要景點名稱與描述建議即可。',
  ]
    .filter(Boolean)
    .join('\n')

  // If the client disconnects (its own timeout fired, tab closed, etc.),
  // stop generating — otherwise Claude finishes the response and we're
  // billed for tokens whose result nobody will ever read.
  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 8192,
        output_config: { format: { type: 'json_schema', schema: PLACE_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal },
    )

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      res.status(502).json({ error: 'Empty AI response' })
      return
    }

    const parsed = JSON.parse(textBlock.text) as { places: unknown }
    res.status(200).json({ places: parsed.places })
  } catch (error) {
    console.error('generate-trip failed', error)
    res.status(502).json({ error: 'AI generation failed' })
  }
}
