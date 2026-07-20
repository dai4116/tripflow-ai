import Anthropic from '@anthropic-ai/sdk'
import { stripBilingualName } from './_lib/placeName.js'

// Vercel's default Node function duration (10s) is too tight for a cold
// start + first-use structured-output schema compilation + generation time
// combined — extend it to match the client's timeout in aiTripClient.ts. 60s
// (not just 30) because the realistic response size grew with pace-based
// place counts (up to 150 places for a packed 30-day trip, vs. the old fixed
// 60) — 60s is also the safe ceiling that doesn't require a paid Vercel plan
// to honor (Hobby caps functions at 60s; Pro/Enterprise allow more).
export const config = { maxDuration: 60 }

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
          geocodeQueryAlt: { type: 'string' },
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
  days?: number
  placesPerDay?: number
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

  const { destination, travelStyle, preferences, avoidPlaces, placeCount, days, placesPerDay: bodyPlacesPerDay } =
    (req.body ?? {}) as GenerateTripBody

  // Upper bounds match the real client's ceiling (computeTripDays clamps to
  // 30 days; placesPerDayForPace tops out at 5/day, i.e. 150 places) with
  // some headroom — not just defense against a malicious caller, but against
  // `days` being 0/negative/missing, which would otherwise let the
  // division-based fallback below divide by zero or corrupt the day-chunking
  // math embedded in the prompt.
  if (!destination || !placeCount || placeCount < 1 || placeCount > 200) {
    res.status(400).json({ error: 'Missing destination or invalid placeCount' })
    return
  }
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 30)) {
    res.status(400).json({ error: 'Invalid days' })
    return
  }
  if (bodyPlacesPerDay !== undefined && (!Number.isInteger(bodyPlacesPerDay) || bodyPlacesPerDay < 1 || bodyPlacesPerDay > 10)) {
    res.status(400).json({ error: 'Invalid placesPerDay' })
    return
  }

  // The client slices the flat `places` array into fixed-size day chunks
  // (see generateTrip.ts) purely by position, with no day-boundary info of
  // its own — so the model has to be told the same chunk size and told to
  // actually respect it, or the day-by-day meal structure below falls apart
  // as soon as the array gets sliced client-side. Prefer the value the
  // client already computed and sends explicitly; only re-derive it via
  // division for an older/different caller that doesn't send it.
  const placesPerDay = bodyPlacesPerDay ?? (days && days > 0 ? Math.round(placeCount / days) : placeCount)

  const prompt = [
    `目的地：${destination}`,
    `旅遊風格：${travelStyle || '文化'}`,
    preferences?.length ? `興趣偏好：${preferences.join('、')}` : '',
    avoidPlaces ? `想避開：${avoidPlaces}` : '',
    '',
    `請推薦恰好 ${placeCount} 個適合這趟旅程的景點。這些景點會依「陣列順序」被平均切成每 ${placesPerDay} 個一組、依序對應到第 1 天到第 ${days || Math.ceil(placeCount / placesPerDay)} 天，所以陣列裡第 1~${placesPerDay} 個請視為第 1 天的行程、第 ${placesPerDay + 1}~${placesPerDay * 2} 個是第 2 天，以此類推。`,
    `每一天對應到的這 ${placesPerDay} 個景點裡，務必包含一個適合當「午餐」的美食類地點（分類 food，安排在當天中段）、一個適合當「晚餐」的美食類地點（分類 food，安排在當天最後一個），其餘景點依旅遊風格與興趣偏好搭配文化、自然、購物、活動等不同類型，並依合理的一天行程順序排列（例如先安排上午的景點，接著午餐，下午再安排其他景點，最後才是晚餐）。`,
    '每個景點包含分類、名稱、一句簡短描述（繁體中文），以及可選的一句實用小提示（travelTip）。',
    '名稱優先使用繁體中文慣用名稱，不要同時附上英文原文或重複的括號翻譯（例如寫「洽圖洽週末市場」，不要寫「Chatuchak Weekend Market（洽圖洽週末市場）」）。若沒有通行的繁體中文名稱，或外文是官方品牌名稱，請保留官方名稱；分店、分校、校區等必要辨識資訊可用繁體中文括號註明（例如「Wall Street English（信義分校）」）。',
    '另外提供 geocodeQuery 欄位：這是給地圖服務（OpenStreetMap）查詢定位用的完整字串，不會顯示給使用者。格式必須是「地點官方名稱, 城市, 國家」，三段全部使用同一種語言，而且優先使用當地官方語言（地圖資料庫幾乎都是用當地語言登記地點名稱，翻成英文常常查不到、或誤配到完全不相關的地方）；只有目的地本身是英語系國家，或這個地點是國際連鎖品牌、慣用英文名稱時，才用英文。絕對不要中文和其他語言混用在同一個 geocodeQuery 裡。例如目的地是義大利佛羅倫斯，應填寫「Galleria degli Uffizi, Firenze, Italia」（義大利文），不要翻成「Uffizi Gallery, Florence, Italy」；目的地是韓國釜山，應填寫「부산시립미술관, 부산, 대한민국」（韓文），不要翻成「Busan Museum of Art, Busan, South Korea」。只有目的地本身是華語地區時，才整段使用中文（例如「九份老街, 新北市, 台灣」）。',
    '如果不確定這個地點在地圖服務上的正式登記名稱（例如是複合式建築、市場、商圈，官方全名可能跟通俗說法不同），請額外提供 geocodeQueryAlt 欄位，格式同 geocodeQuery，但改用更簡短、更通用的常見說法（例如 geocodeQuery 是「Mercato Centrale di San Lorenzo, Firenze, Italia」，geocodeQueryAlt 可以是「Mercato Centrale, Firenze, Italia」），作為查詢失敗時的備援；有把握的話可以不用提供這個欄位。另一種常見狀況是地點名稱本身已經把城市名黏在前面（例如「부산영화체험박물관」），這種寫法常常查不到，這時 geocodeQueryAlt 請把城市名從地點名稱裡拿掉、只留給城市那個欄位（例如寫成「영화체험박물관, 부산, 대한민국」）。',
    '只推薦你有信心真實存在的景點，不要為了湊類型或數量而生造出聽起來像正式機構、但你不確定是否存在的名稱（例如自己組合出一個「XX博物館」）。不確定某個細分機構是否存在時，請改推薦你比較有把握的知名地標，或是更廣義但確實存在的地點（例如某商圈、某條老街），不要用一個可能不存在的專有名稱硬湊。',
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
    // Sonnet 5 runs adaptive thinking by default when `thinking` is omitted
    // (unlike Haiku, which never thinks unless asked) — those tokens would
    // otherwise share this call's max_tokens budget with the JSON output for
    // no benefit, since this is pure structured extraction with nothing to
    // reason through. Explicitly disabling it keeps the whole budget for
    // the response itself.
    //
    // max_tokens is sized for the realistic ceiling now that place count is
    // pace-based (up to 30 days x 5 packed = 150 places, vs. the old fixed
    // 60), each place carrying several Chinese-text fields plus two geocode
    // query strings — comfortably over the ~16K non-streaming SDK timeout
    // threshold, hence .stream() + finalMessage() instead of .create().
    const stream = client.messages.stream(
      {
        // Sonnet over Haiku specifically for this call — geocodeQuery/
        // geocodeQueryAlt accuracy depends on the model actually knowing a
        // place's exact official local-language name (including recent
        // renamings, correct loanword vs. native spelling, etc.), and Haiku
        // was found to guess plausible-but-wrong names too often (e.g.
        // "PIFF" instead of the post-2016 "BIFF", extra/missing syllables).
        model: 'claude-sonnet-5',
        max_tokens: 32000,
        thinking: { type: 'disabled' },
        output_config: { format: { type: 'json_schema', schema: PLACE_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal },
    )
    const response = await stream.finalMessage()

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
