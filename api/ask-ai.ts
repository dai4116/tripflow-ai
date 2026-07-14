import Anthropic from '@anthropic-ai/sdk'

// Chat replies are small (one tool call or a short sentence), so this
// doesn't need the full 30s budget generate-trip.ts uses for a whole
// itinerary — but still gives room for a cold start.
export const config = { maxDuration: 20 }

// Loosely typed on purpose — see api/generate-trip.ts for why.
type VercelLikeRequest = {
  method?: string
  body?: unknown
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

// Each tool carries its own `message` field — a Traditional Chinese
// confirmation sentence — so the whole exchange (decide + explain) happens
// in one model call, and the client can render it directly without a
// second round trip.
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'move_place',
    description: '把行程裡「已經存在」的一個地點搬到另一天。使用者要指名明確的地點與目標天數才適用。',
    input_schema: {
      type: 'object',
      properties: {
        placeId: { type: 'string', description: '要搬動的地點 ID（從提供的行程資料中選擇）' },
        toColumnId: { type: 'string', description: '目標那一天的 column ID（從提供的行程資料中選擇）' },
        message: { type: 'string', description: '用繁體中文向使用者確認這個變更的一句話' },
      },
      required: ['placeId', 'toColumnId', 'message'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'remove_place',
    description: '把行程裡「已經存在」的一個地點整個移除。',
    input_schema: {
      type: 'object',
      properties: {
        placeId: { type: 'string', description: '要移除的地點 ID（從提供的行程資料中選擇）' },
        message: { type: 'string', description: '用繁體中文向使用者確認這個變更的一句話' },
      },
      required: ['placeId', 'message'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'suggest_places',
    description: '幫某一天推薦 1-2 個新景點加入行程。使用者要求推薦、增加、補充景點時使用，跟「搬動/移除既有地點」是不同的情境。',
    input_schema: {
      type: 'object',
      properties: {
        columnId: { type: 'string', description: '要加入新景點的那一天的 column ID（從提供的行程資料中選擇）' },
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
        // No `message` field here on purpose — the client builds the
        // confirmation sentence itself from `places`, so the names always
        // show up exactly once instead of depending on whether Claude's own
        // phrasing happens to mention them (it was inconsistent).
      },
      required: ['columnId', 'places'],
      additionalProperties: false,
    },
    strict: true,
  },
]

type ColumnSummary = {
  id: string
  dayNumber: number
  title: string
  places: { id: string; name: string; category: string }[]
}

type AskAiBody = {
  message?: string
  destination?: string
  columns?: ColumnSummary[]
}

function buildPrompt(message: string, destination: string, columns: ColumnSummary[]): string {
  const itinerary = columns
    .map((column) => {
      const placeList = column.places.length
        ? column.places.map((place) => `${place.name}（id: ${place.id}, 分類: ${place.category}）`).join('、')
        : '（目前沒有景點）'
      return `第 ${column.dayNumber} 天（column id: ${column.id}）：${placeList}`
    })
    .join('\n')

  return [
    `你是一個旅遊行程規劃助手，正在協助使用者調整「${destination}」的行程看板。`,
    '',
    '目前行程：',
    itinerary,
    '',
    `使用者的訊息：「${message}」`,
    '',
    '請根據使用者的意圖，判斷是否該呼叫其中一個工具（move_place / remove_place / suggest_places）。',
    '如果使用者的訊息不屬於任何一種明確的編輯請求（例如閒聊、問候、不清楚的內容、或是開放式的規劃建議問題），不要呼叫任何工具，改用文字回覆。',
    '文字回覆的規則：這裡是聊天視窗的對話氣泡，不是報告，一律限制在 1-2 句話以內，用自然口語的繁體中文；絕對不要使用 markdown 語法（不要 **粗體**、不要條列符號、不要標題），因為顯示畫面不會解析這些符號，只會照樣印出星號。',
    '地點與天數請一律使用上面提供的 id，不要自己編造。',
  ].join('\n')
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

  const { message, destination, columns } = (req.body ?? {}) as AskAiBody
  if (!message?.trim() || !Array.isArray(columns)) {
    res.status(400).json({ error: 'Missing message or columns' })
    return
  }

  const prompt = buildPrompt(message.trim(), destination || '這趟旅程', columns)

  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        tools: TOOLS,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal },
    )

    const toolUse = response.content.find((block) => block.type === 'tool_use')
    if (toolUse && toolUse.type === 'tool_use') {
      res.status(200).json({ type: 'tool_use', name: toolUse.name, input: toolUse.input })
      return
    }

    const textBlock = response.content.find((block) => block.type === 'text')
    res.status(200).json({ type: 'text', text: textBlock?.type === 'text' ? textBlock.text : '了解。' })
  } catch (error) {
    console.error('ask-ai failed', error)
    res.status(502).json({ error: 'AI request failed' })
  }
}
