import Anthropic from '@anthropic-ai/sdk'
import { stripBilingualName } from './_lib/placeName.js'

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

const PLACE_CATEGORIES = ['food', 'attraction', 'shopping', 'stay', 'transport', 'other'] as const
const TIME_OF_DAY_OPTIONS = ['morning', 'afternoon', 'evening', 'anytime'] as const

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
              geocodeQuery: { type: 'string' },
              geocodeQueryAlt: { type: 'string' },
              description: { type: 'string' },
              timeOfDay: { type: 'string', enum: TIME_OF_DAY_OPTIONS },
            },
            required: ['category', 'name', 'geocodeQuery', 'description', 'timeOfDay'],
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
  {
    name: 'reorder_day',
    description:
      '把某一天「所有」地點依地理位置重新排序，讓當天路線比較順、不繞路。使用者要求整天重新排序時使用，說法可能是按路線排、順路一點、一鍵排序、幫我整理路線、重新排一次等；只是要搬動單一地點到別天，請用 move_place。',
    input_schema: {
      type: 'object',
      properties: {
        columnId: { type: 'string', description: '要重新排序的那一天的 column ID（從提供的行程資料中選擇）' },
        // No `message` field — same reasoning as suggest_places. The actual
        // reordering is computed client-side from real lat/lng (see
        // AskAiPanel.vue's computeRouteOrder), not guessed by the model, so
        // the confirmation sentence is built there too instead of trusting
        // Claude to describe a route it never actually computed.
      },
      required: ['columnId'],
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
    '請根據使用者的意圖，判斷是否該呼叫其中一個工具（move_place / remove_place / suggest_places / reorder_day）。',
    'reorder_day 只適用於使用者要求「整天」重新排序、按路線排、順路一點的情境，包括各種不同說法，例如「一鍵排序」「幫我整理路線」「順序亂了幫我排一下」「重新排一次」等——只要意思是整天重排就算；如果只是要搬動某一個特定地點到別天，請用 move_place。',
    'suggest_places 建議的地點名稱優先使用繁體中文慣用名稱，不要同時附上英文原文或重複的括號翻譯（例如寫「洽圖洽週末市場」，不要寫「Chatuchak Weekend Market（洽圖洽週末市場）」）。若沒有通行的繁體中文名稱，或外文是官方品牌名稱，請保留官方名稱；分店、分校、校區等必要辨識資訊可用繁體中文括號註明（例如「Wall Street English（信義分校）」）。',
    'suggest_places 每個地點另外要填 timeOfDay 欄位，標示這個地點通常/最適合什麼時段前往：morning（適合上午，例如市場、日出景點）、afternoon（適合下午，沒有明顯時段限制的多數景點也可以用這個）、evening（只適合晚上或傍晚以後，例如夜市、酒吧、夜景、只供應晚餐的餐廳）、anytime（真的完全不受時段限制，例如大型商場、一般博物館）。請依你對這個地點的實際了解判斷，不要每個都填同一個值敷衍。',
    'suggest_places 每個地點另外提供 geocodeQuery 欄位：這是給地圖服務（OpenStreetMap）查詢定位用的完整字串，不會顯示給使用者。格式必須是「地點官方名稱, 城市, 國家」，三段全部使用同一種語言，而且優先使用當地官方語言（地圖資料庫幾乎都是用當地語言登記，翻成英文常常查不到或誤配到不相關的地方）；只有目的地本身是英語系國家，或這個地點是國際連鎖品牌慣用英文名稱時，才用英文。絕對不要中文和其他語言混用在同一個 geocodeQuery 裡。只有目的地本身是華語地區時，才整段使用中文。',
    '如果不確定正式登記名稱，額外提供 geocodeQueryAlt 欄位（格式同 geocodeQuery，但用更簡短通用的說法），作為查詢失敗時的備援；有把握的話可以不用提供。若地點名稱本身把城市名黏在前面（例如「부산영화체험박물관」），這種寫法常常查不到，geocodeQueryAlt 請把城市名從地點名稱裡拿掉、只留給城市欄位。',
    'suggest_places 只推薦你有信心真實存在的景點，不要為了湊數量而生造出聽起來像正式機構、但你不確定是否存在的名稱。不確定某個細分機構是否存在時，請改推薦你比較有把握的知名地標，或更廣義但確實存在的地點。',
    '如果使用者的訊息與這趟行程規劃有關，但不屬於任何一種明確的編輯請求（例如閒聊、問候、不清楚的內容、或是開放式的規劃建議問題），不要呼叫任何工具，改用文字回覆，正常回應。',
    '如果使用者的訊息與旅遊行程規劃完全無關（例如天氣、新聞時事、程式問題等和這趟旅程無關的一般常識問題），不要呼叫任何工具，也不要嘗試回答問題本身，改用委婉自然的口吻簡短說明你只能協助這趟行程的規劃、沒辦法回答這類問題。',
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
        // Sonnet over Haiku — same reasoning as generate-trip.ts: Haiku's
        // geocodeQuery/geocodeQueryAlt guesses for suggest_places were often
        // plausible-but-wrong (outdated names, wrong syllables). Responses
        // here stay small (one tool call or 1-2 sentences), so the latency
        // cost is modest even though this endpoint is otherwise favored for
        // being fast.
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        // Sonnet 5 runs adaptive thinking by default when `thinking` is
        // omitted — wasted here, since deciding which tool to call (or
        // writing a 1-2 sentence reply) doesn't need step-by-step reasoning,
        // and thinking tokens would eat into this endpoint's already-tight
        // 2048 budget for no benefit.
        thinking: { type: 'disabled' },
        tools: TOOLS,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal },
    )

    const toolUse = response.content.find((block) => block.type === 'tool_use')
    if (toolUse && toolUse.type === 'tool_use') {
      const input = toolUse.input as { places?: { name: string }[] }
      if (toolUse.name === 'suggest_places' && Array.isArray(input.places)) {
        input.places = input.places.map((place) => ({ ...place, name: stripBilingualName(place.name) }))
      }
      res.status(200).json({ type: 'tool_use', name: toolUse.name, input })
      return
    }

    const textBlock = response.content.find((block) => block.type === 'text')
    res.status(200).json({ type: 'text', text: textBlock?.type === 'text' ? textBlock.text : '了解。' })
  } catch (error) {
    console.error('ask-ai failed', error)
    res.status(502).json({ error: 'AI request failed' })
  }
}
