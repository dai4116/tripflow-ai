import Anthropic from '@anthropic-ai/sdk'
import { stripBilingualName } from './_lib/placeName.js'

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
          geocodeQuery: { type: 'string' },
          description: { type: 'string' },
          travelTip: { type: 'string' },
        },
        required: ['category', 'name', 'geocodeQuery', 'description'],
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
    '名稱優先使用繁體中文慣用名稱，不要同時附上英文原文或重複的括號翻譯（例如寫「洽圖洽週末市場」，不要寫「Chatuchak Weekend Market（洽圖洽週末市場）」）。若沒有通行的繁體中文名稱，或外文是官方品牌名稱，請保留官方名稱；分店、分校、校區等必要辨識資訊可用繁體中文括號註明（例如「Wall Street English（信義分校）」）。',
    '另外提供 geocodeQuery 欄位：這是給地圖服務（OpenStreetMap）查詢定位用的完整字串，不會顯示給使用者。格式必須是「地點官方名稱, 城市, 國家」，三段全部使用同一種語言——當地官方語言或英文（不要中英文混用，也不要只寫地點名稱、漏掉城市和國家，否則常常查不到或定位到錯誤的地方）。例如目的地是義大利佛羅倫斯，應填寫「Galleria degli Uffizi, Firenze, Italia」或「Uffizi Gallery, Florence, Italy」，不要寫「Uffizi Gallery, 佛羅倫斯, 義大利」。只有目的地本身是華語地區時，才整段使用中文（例如「九份老街, 新北市, 台灣」）。',
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

    const parsed = JSON.parse(textBlock.text) as { places: { name: string }[] }
    const places = parsed.places.map((place) => ({ ...place, name: stripBilingualName(place.name) }))
    // geocodeQuery is passed through as-is (not stripBilingualName'd) — unlike
    // the display name, it's meant to stay in whatever language actually
    // matches how the map provider indexes the place.
    res.status(200).json({ places })
  } catch (error) {
    console.error('generate-trip failed', error)
    res.status(502).json({ error: 'AI generation failed' })
  }
}
