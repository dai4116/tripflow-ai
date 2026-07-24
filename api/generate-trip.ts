import Anthropic from '@anthropic-ai/sdk'
import { stripBilingualName } from './_lib/placeName.js'
import { distanceKm, geocodeCityCenter, verifyPlace, type GeoPoint } from './_lib/placesVerify.js'

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
          // Which day (1-indexed) this candidate belongs to — the source of
          // truth for day grouping now, not array position. Verification
          // drops arbitrary candidates, so grouping by an explicit tag (and
          // capping per day server-side) keeps one day's losses from
          // cascading into every later day, unlike slicing a flat array by
          // position once it's shorter than expected.
          day: { type: 'integer' },
          category: { type: 'string', enum: PLACE_CATEGORIES },
          name: { type: 'string' },
          geocodeQuery: { type: 'string' },
          geocodeQueryAlt: { type: 'string' },
          description: { type: 'string' },
          travelTip: { type: 'string' },
        },
        required: ['day', 'category', 'name', 'geocodeQuery', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['places'],
  additionalProperties: false,
}

// Stage 1's output shape — a day-by-day theme/area outline for the WHOLE
// trip, decided in one call before any actual places are generated. See its
// caller for why this exists: independent per-batch calls (stage 2) can't
// see each other's picks, so without a shared plan they converge on the same
// handful of famous landmarks and produce disjointed, cross-town itineraries
// day to day. This call is cheap (short labels, not full place details), so
// it can afford to look at every day at once the way a single unified call
// would, without reintroducing the timeout stage 2's batching exists to fix.
const ZONE_SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer' },
          zone: { type: 'string' },
          focus: { type: 'string' },
        },
        required: ['day', 'zone', 'focus'],
        additionalProperties: false,
      },
    },
  },
  required: ['days'],
  additionalProperties: false,
}

// Each selected travel style (up to 2, chosen on the form) biases content,
// not just pace — the client already resolves pace/placesPerDay from these
// same style names (see paceForTravelStyles in src/data/generateTrip.ts);
// this is the content half. Kept as a separate copy here rather than a
// shared import: api/ and src/ are independent deployable units (the
// existing PLACE_CATEGORIES above is the same pattern — nothing under api/
// imports from src/), so the style names themselves are the only thing that
// has to stay in sync by hand if the option list ever changes.
const STYLE_FLAVOR: Record<string, string> = {
  精準規劃: '偏好效率高、評價好的必去景點，盡量減少繞路移動',
  自在慢旅: '景點數不用多，重視氛圍與步調，不趕行程',
  深度探索: '偏好小眾景點、巷弄與在地生活體驗，避免只選熱門觀光打卡點',
  熱血冒險: '偏好戶外、有挑戰性、新奇的活動與體驗',
  質感享受: '偏好美食、購物、住宿品質等舒適體驗',
}

function styleFlavorLines(travelStyle: string[] | undefined): string {
  return (travelStyle ?? [])
    .map((style) => STYLE_FLAVOR[style])
    .filter((flavor): flavor is string => Boolean(flavor))
    .join('\n')
}

// Runs `fn` over `items` with at most `limit` in flight at once. Verification
// fires one Google call per candidate (up to ~90 for a long trip); handing
// all of them to Promise.all at once means the serverless sandbox's limited
// CPU has to service dozens of simultaneous TLS handshakes, which queues
// rather than truly parallelizes — the per-call 8s timeout in placesVerify.ts
// then can't bound the *total* time, since it only caps one call, not the
// queueing delay before it starts. A small worker pool keeps genuine
// parallelism (still much faster than sequential) without that pileup.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    for (;;) {
      const i = nextIndex++
      if (i >= items.length) return
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

type GenerateTripBody = {
  destination?: string
  // Up to 2 style archetypes selected on the form (e.g. ['精準規劃', '深度探索'])
  // — see STYLE_FLAVOR below for how each one biases generation content, on
  // top of the pace/placesPerDay the client already resolved from them.
  travelStyle?: string[]
  preferences?: string[]
  // Free-text catch-all — places to avoid, but just as often a positive
  // request (dietary needs, "want a beach day", traveling with kids). See
  // its prompt line below for why it's framed neutrally, not as exclusions.
  additionalNotes?: string
  placeCount?: number
  days?: number
  placesPerDay?: number
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  const handlerStart = Date.now()
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'AI generation not configured' })
    return
  }

  const { destination, travelStyle, preferences, additionalNotes, placeCount, days, placesPerDay: bodyPlacesPerDay } =
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

  // The client groups places by their `day` tag now, not by array position
  // (see generateTrip.ts) — so the model just needs to know the day count and
  // per-day target, not a chunk size it has to respect positionally.
  const placesPerDay = bodyPlacesPerDay ?? (days && days > 0 ? Math.round(placeCount / days) : placeCount)
  const totalDays = days ?? Math.ceil(placeCount / placesPerDay)

  // Over-ask PER DAY (not once globally): every candidate is verified against
  // Google Places server-side and anything unfindable is dropped, then each
  // day is capped independently at placesPerDay survivors (see the grouping
  // below). A single global buffer let one day's losses consume every later
  // day's budget once the flat array ran short — confirmed live: a 7-day
  // trip lost all of days 4-7 that way. A per-day buffer keeps a bad day's
  // attrition from ever touching another day's candidates.
  const PER_DAY_BUFFER = 2
  const perDayCandidates = placesPerDay + PER_DAY_BUFFER

  // Cap on candidates requested per Claude call, and the day-batching that
  // enforces it. One call asking for a whole 7-day trip's ~42 candidates was
  // measured live at ~70s of pure generation time (confirmed via Vercel's own
  // request trace: the only external call was to api.anthropic.com, timed
  // out mid-stream — Google verification never even started) — already over
  // Vercel's 60s Hobby-tier limit regardless of the schema or verification
  // step. Splitting the trip into day-batches and running them as parallel
  // Claude calls keeps each call's output small, so its generation time
  // stays roughly constant instead of growing with trip length — total wall
  // time then tracks one batch's time (batches run concurrently), not the
  // sum of all of them. Lowered from 20 (its original, empirically-tested
  // value) to leave headroom for the zone-planning call below, which now
  // runs sequentially before these batches start — untested against a live
  // key as of this change, so err conservative rather than guess exactly
  // how much margin 20 would have left.
  const MAX_CANDIDATES_PER_CALL = 14
  const daysPerBatch = Math.max(1, Math.floor(MAX_CANDIDATES_PER_CALL / perDayCandidates))
  const dayBatches: number[][] = []
  for (let start = 1; start <= totalDays; start += daysPerBatch) {
    const end = Math.min(start + daysPerBatch - 1, totalDays)
    dayBatches.push(Array.from({ length: end - start + 1 }, (_, i) => start + i))
  }

  // Populated by the zone-planning call below before any batch prompt is
  // actually built (batches don't run until after it resolves) — declared
  // here, not const, because buildPrompt closes over it and needs to see
  // whatever the planning call produced (or an empty map if it failed).
  let zonesByDay = new Map<number, { zone: string; focus: string }>()

  // Stage 1's prompt — plans the whole trip's day-by-day theme/area in one
  // shot, the way a single unified call naturally would (confirmed live:
  // asking Claude directly for a full 7-day itinerary in one conversation
  // produces coherent, non-repeating, geographically sensible days, e.g.
  // grouping 潭子摘星山莊 + 新社莊園 into one suburb day — exactly the kind
  // of area stage 2's independent batches have no way to arrive at on their
  // own). Output here is just short labels, not full place details, so it
  // should stay fast even though it (unlike stage 2) covers every day at once.
  function buildZonePlanPrompt(): string {
    return [
      `目的地：${destination}`,
      travelStyle?.length ? `旅遊風格：${travelStyle.join('、')}` : '',
      styleFlavorLines(travelStyle),
      preferences?.length ? `興趣偏好：${preferences.join('、')}` : '',
      additionalNotes ? `其他補充需求：${additionalNotes}（可能是想避開的地方，也可能是其他偏好或限制，請依內容判斷並納入行程考量）` : '',
      '',
      `請先幫我規劃一趟共 ${totalDays} 天行程的「每日主題與區域」大綱——還不用列出具體景點，只需要決定每天要去哪個區域、聚焦什麼主題。`,
      `請通盤考慮全部 ${totalDays} 天：每天的區域/主題都要不一樣，不要讓同一個知名景點或商圈在兩天的主題描述裡都出現。`,
      '主題請有變化，混合市區文化商圈、老街/夜市、自然景觀與近郊景點、歷史建築等不同類型——不要每天都侷限在市中心最知名的那幾個地方，也請適度考慮比較不那麼觀光客爆滿、但確實存在且值得一去的近郊區域。',
      preferences?.length
        ? '興趣偏好裡提到的類型，請確保至少反映在一天以上的主題安排裡（例如提到「自然秘境」，就該有一天以自然景觀/近郊為主）。'
        : '',
      '如果天數較多，可以把地理上相近的主題安排在相鄰的天數，讓整體動線比較順；不用嚴格照順序，但盡量避免同一趟行程在城市各角落之間跳來跳去。',
      `每天請給一個簡短的「區域/主題」名稱（zone，例如「草悟道／勤美文青核心區」），和一句「聚焦內容」的簡短說明（focus，例如「文創園區、咖啡廳、老屋改造」）。用 day 欄位標明第幾天（1 到 ${totalDays} 的整數）。`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  function buildPrompt(dayNumbers: number[]): string {
    const dayList = dayNumbers.join('、')
    const batchRequestCount = dayNumbers.length * perDayCandidates
    // Stage 1's per-day theme, handed to whichever batch owns that day —
    // this is what keeps this batch's picks geographically clustered and
    // distinct from every other day's, instead of each batch freely
    // choosing wherever it wants with no view of the other days.
    const zoneLines = dayNumbers
      .map((d) => {
        const z = zonesByDay.get(d)
        return z ? `第${d}天主題：「${z.zone}」——${z.focus}` : ''
      })
      .filter(Boolean)
      .join('\n')
    return [
      `目的地：${destination}`,
      travelStyle?.length ? `旅遊風格：${travelStyle.join('、')}` : '',
      styleFlavorLines(travelStyle),
      preferences?.length ? `興趣偏好：${preferences.join('、')}` : '',
      additionalNotes ? `其他補充需求：${additionalNotes}（可能是想避開的地方，也可能是其他偏好或限制，請依內容判斷並納入行程考量）` : '',
      '',
      // This call only covers a slice of the trip (its own batch of days) —
      // told explicitly so the model doesn't try to pace itself as if this
      // were the whole itinerary.
      `這是一趟共 ${totalDays} 天行程裡的第 ${dayList} 天。請只規劃這幾天，每個景點都要用 day 欄位標明屬於第幾天（必須是 ${dayList} 其中之一），總共推薦約 ${batchRequestCount} 個景點候選。`,
      zoneLines
        ? `以下是已經先規劃好的每日主題，請在指定的區域/主題範圍內挑選具體、確實存在的地點，不要跳出這個主題去選其他區域的景點：\n${zoneLines}`
        : '',
      `每一天請提供最多 ${perDayCandidates} 個候選景點——比當天實際需要的 ${placesPerDay} 個多 ${PER_DAY_BUFFER} 個，多出來的是備援（見下方說明）。同一天的候選請依你的信心排序，越有把握、越具體明確的排越前面。`,
      `每一天的候選景點裡，盡量包含一個適合當「午餐」的美食類地點（分類 food）、一個適合當「晚餐」的美食類地點（分類 food），其餘搭配文化、自然、購物、活動等不同類型。`,
      `重要：我們會把每個候選拿去真實地圖（Google 地圖）逐一驗證，每一天只會保留「確實查得到、能定位」的前 ${placesPerDay} 個（依你排的信心順序），查不到的直接丟棄。同一天的備援只會遞補同一天被丟棄的名額，不會被其他天借用——所以每一天請務必自己給滿 ${perDayCandidates} 個，不要因為某天景點少就少給。另外請「只」推薦你有把握真實存在、地圖上找得到的『具體、明確』地點——寧可某天候選數不足，也不要放模糊的類別式名稱（例如「清水在地小吃」「中信市場美食」這種不是特定店家/地標的名稱）或你不確定是否存在的名稱。`,
      '每個景點包含分類、名稱、一句簡短描述（繁體中文），以及可選的一句實用小提示（travelTip）。',
      '名稱優先使用繁體中文慣用名稱，不要同時附上英文原文或重複的括號翻譯（例如寫「洽圖洽週末市場」，不要寫「Chatuchak Weekend Market（洽圖洽週末市場）」）。若沒有通行的繁體中文名稱，或外文是官方品牌名稱，請保留官方名稱；分店、分校、校區等必要辨識資訊可用繁體中文括號註明（例如「Wall Street English（信義分校）」）。',
      '另外提供 geocodeQuery 欄位：這是給地圖服務（OpenStreetMap）查詢定位用的完整字串，不會顯示給使用者。格式必須是「地點官方名稱, 城市, 國家」，三段全部使用同一種語言，而且優先使用當地官方語言（地圖資料庫幾乎都是用當地語言登記地點名稱，翻成英文常常查不到、或誤配到完全不相關的地方）；只有目的地本身是英語系國家，或這個地點是國際連鎖品牌、慣用英文名稱時，才用英文。絕對不要中文和其他語言混用在同一個 geocodeQuery 裡。例如目的地是義大利佛羅倫斯，應填寫「Galleria degli Uffizi, Firenze, Italia」（義大利文），不要翻成「Uffizi Gallery, Florence, Italy」；目的地是韓國釜山，應填寫「부산시립미술관, 부산, 대한민국」（韓文），不要翻成「Busan Museum of Art, Busan, South Korea」。只有目的地本身是華語地區時，才整段使用中文（例如「九份老街, 新北市, 台灣」）。',
      '如果不確定這個地點在地圖服務上的正式登記名稱（例如是複合式建築、市場、商圈，官方全名可能跟通俗說法不同），請額外提供 geocodeQueryAlt 欄位，格式同 geocodeQuery，但改用更簡短、更通用的常見說法（例如 geocodeQuery 是「Mercato Centrale di San Lorenzo, Firenze, Italia」，geocodeQueryAlt 可以是「Mercato Centrale, Firenze, Italia」），作為查詢失敗時的備援；有把握的話可以不用提供這個欄位。另一種常見狀況是地點名稱本身已經把城市名黏在前面（例如「부산영화체험박물관」），這種寫法常常查不到，這時 geocodeQueryAlt 請把城市名從地點名稱裡拿掉、只留給城市那個欄位（例如寫成「영화체험박물관, 부산, 대한민국」）。',
      '只推薦你有信心真實存在的景點，不要為了湊類型或數量而生造出聽起來像正式機構、但你不確定是否存在的名稱（例如自己組合出一個「XX博物館」）。不確定某個細分機構是否存在時，請改推薦你比較有把握的知名地標，或是更廣義但確實存在的地點（例如某商圈、某條老街），不要用一個可能不存在的專有名稱硬湊。',
      '不要編造具體的評分、地址或經緯度——只需要景點名稱與描述建議即可。',
    ]
      .filter(Boolean)
      .join('\n')
  }

  // If the client disconnects (its own timeout fired, tab closed, etc.),
  // stop generating — otherwise Claude finishes the response and we're
  // billed for tokens whose result nobody will ever read.
  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  type AiPlace = {
    day: number
    category: string
    name: string
    geocodeQuery?: string
    geocodeQueryAlt?: string
    description: string
    travelTip?: string
  }

  try {
    const client = new Anthropic({ apiKey })

    // Used only for the empty-day backfill below — always a single-day
    // batch, so it gets the guaranteed-correct day tagging the multi-day
    // batches above can't offer (see the comment on the backfill call site).
    async function generateSingleDayBatch(day: number): Promise<AiPlace[]> {
      try {
        const stream = client.messages.stream(
          {
            model: 'claude-sonnet-5',
            max_tokens: 8000,
            thinking: { type: 'disabled' },
            output_config: { format: { type: 'json_schema', schema: PLACE_SCHEMA } },
            messages: [{ role: 'user', content: buildPrompt([day]) }],
          },
          { signal: controller.signal },
        )
        const response = await stream.finalMessage()
        const textBlock = response.content.find((block) => block.type === 'text')
        if (!textBlock || textBlock.type !== 'text') return []
        const parsed = JSON.parse(textBlock.text) as { places: AiPlace[] }
        return (parsed.places ?? []).map((place) => ({ ...place, day }))
      } catch (error) {
        console.error(`[generate-trip] backfill batch for day ${day} failed`, error)
        return []
      }
    }

    // Stage 1: plan the whole trip's day-by-day zones in one call before any
    // batch starts generating actual places (see buildZonePlanPrompt's
    // comment). Best-effort — if this fails or times out, fall through with
    // an empty zonesByDay and stage 2 just generates without zone hints,
    // same behavior as before this feature existed. Never lets a zone-
    // planning failure sink the whole trip.
    try {
      const zoneStream = client.messages.stream(
        {
          model: 'claude-sonnet-5',
          // Output here is only ~totalDays short labels, nowhere near this
          // ceiling — sized generously anyway since going over would force
          // an early cutoff mid-JSON with no partial-result fallback.
          max_tokens: 4000,
          thinking: { type: 'disabled' },
          output_config: { format: { type: 'json_schema', schema: ZONE_SCHEMA } },
          messages: [{ role: 'user', content: buildZonePlanPrompt() }],
        },
        { signal: controller.signal },
      )
      const zoneResponse = await zoneStream.finalMessage()
      const zoneTextBlock = zoneResponse.content.find((block) => block.type === 'text')
      if (zoneTextBlock && zoneTextBlock.type === 'text') {
        const zoneParsed = JSON.parse(zoneTextBlock.text) as {
          days?: Array<{ day: number; zone: string; focus: string }>
        }
        for (const entry of zoneParsed.days ?? []) {
          if (Number.isInteger(entry.day) && entry.day >= 1 && entry.day <= totalDays) {
            zonesByDay.set(entry.day, { zone: entry.zone, focus: entry.focus })
          }
        }
      }
    } catch (error) {
      console.error('[generate-trip] zone planning failed, continuing without zone hints', error)
    }
    console.log(
      `[generate-trip] zone planning: ${Date.now() - handlerStart}ms elapsed, ${zonesByDay.size}/${totalDays} days planned`,
    )

    // Batches run concurrently, capped — same reasoning as the Google
    // verification batch below: too many simultaneous requests queue rather
    // than truly overlap on a resource-constrained serverless sandbox, and
    // a large parallel burst risks the account's own rate limit.
    const CLAUDE_CONCURRENCY = 6
    const batchResults = await mapWithConcurrency(dayBatches, CLAUDE_CONCURRENCY, async (dayNumbers) => {
      try {
        // Sonnet 5 runs adaptive thinking by default when `thinking` is
        // omitted (unlike Haiku, which never thinks unless asked) — those
        // tokens would otherwise share this call's max_tokens budget with
        // the JSON output for no benefit, since this is pure structured
        // extraction with nothing to reason through.
        //
        // Sonnet over Haiku specifically for this call — geocodeQuery/
        // geocodeQueryAlt accuracy depends on the model actually knowing a
        // place's exact official local-language name (including recent
        // renamings, correct loanword vs. native spelling, etc.), and Haiku
        // was found to guess plausible-but-wrong names too often (e.g.
        // "PIFF" instead of the post-2016 "BIFF", extra/missing syllables).
        const stream = client.messages.stream(
          {
            model: 'claude-sonnet-5',
            // Sized for one batch's ceiling (MAX_CANDIDATES_PER_CALL, plus
            // headroom) — not the whole trip's, now that batches are per-call.
            max_tokens: 8000,
            thinking: { type: 'disabled' },
            output_config: { format: { type: 'json_schema', schema: PLACE_SCHEMA } },
            messages: [{ role: 'user', content: buildPrompt(dayNumbers) }],
          },
          { signal: controller.signal },
        )
        const response = await stream.finalMessage()
        const textBlock = response.content.find((block) => block.type === 'text')
        if (!textBlock || textBlock.type !== 'text') return []
        const parsed = JSON.parse(textBlock.text) as { places: AiPlace[] }
        const places = parsed.places ?? []

        // The prompt tells this call exactly which days it may use, but
        // nothing enforced it — a mistagged candidate (e.g. the model
        // defaulting to day 1 instead of the actual day number) would
        // silently land in a DIFFERENT day's bucket at merge time, both
        // stealing that day's slot and leaving this batch's real day looking
        // empty. Working theory for a live report (7-day trip, day 7 alone
        // in its own batch, came back with zero places) — not confirmed from
        // logs yet, but this guard is correct defense-in-depth regardless;
        // the mismatch counts logged below will confirm it next time if
        // it's the actual cause.
        if (dayNumbers.length === 1) {
          // No ambiguity possible — every candidate belongs to this one day
          // by construction, so force the tag instead of trusting (and
          // risking losing) the model's own day field.
          const mistagged = places.filter((place) => place.day !== dayNumbers[0]).length
          if (mistagged > 0) {
            console.error(`[generate-trip] batch for day ${dayNumbers[0]} had ${mistagged} candidate(s) tagged with the wrong day, corrected`)
          }
          return places.map((place) => ({ ...place, day: dayNumbers[0]! }))
        }
        // A multi-day batch can't be force-corrected the same way (we don't
        // know which of *this batch's* days a mistagged candidate meant), so
        // just drop anything tagged outside the set of days this call was
        // actually asked to produce, rather than let it float into a day
        // this call knows nothing about.
        const validDays = new Set(dayNumbers)
        const onTopic = places.filter((place) => validDays.has(place.day))
        if (onTopic.length < places.length) {
          console.error(
            `[generate-trip] batch for day(s) ${dayNumbers.join(',')} returned ${places.length - onTopic.length} candidate(s) tagged with a day outside this batch`,
          )
        }
        return onTopic
      } catch (error) {
        // One batch failing (rate limit, transient network error) shouldn't
        // sink the whole trip — the other batches' days still come back, and
        // the final all-empty check below is the real failure signal.
        console.error(`[generate-trip] batch for day(s) ${dayNumbers.join(',')} failed`, error)
        return []
      }
    })
    console.log(
      `[generate-trip] claude generation: ${Date.now() - handlerStart}ms elapsed, ${dayBatches.length} batches, ${batchResults.flat().length} raw candidates`,
    )

    // geocodeQuery is passed through as-is (not stripBilingualName'd) — unlike
    // the display name, it's meant to stay in whatever language actually
    // matches how the map provider indexes the place. Not deduped here —
    // two candidates can only be known to be the same real place *after*
    // Google verification resolves their identity (see the placeId-based
    // dedup below); comparing the AI's own raw name strings at this stage
    // misses exactly the collisions that matter.
    const aiPlaces = batchResults.flat().map((place) => ({ ...place, name: stripBilingualName(place.name) }))
    console.log(`[generate-trip] parsed ${aiPlaces.length} candidates, ${Date.now() - handlerStart}ms elapsed`)

    const googleKey = process.env.GOOGLE_PLACES_API_KEY
    if (!googleKey) {
      // No Places key configured yet — fall back to the pre-verification
      // behavior: hand back the AI's picks (still day-tagged; the client
      // groups by day regardless of source) without coordinates, and let the
      // client geocode them via Nominatim as before. Keeps the app working in
      // the interim; verification switches on automatically once the key is
      // set, with no other change needed.
      res.status(200).json({ places: aiPlaces.slice(0, placeCount) })
      return
    }

    // Verify every candidate against Google Places, region-locked to the
    // destination, in parallel. Each survivor carries its authoritative
    // coordinates; anything Google can't find (or that lands in the wrong
    // city) resolves to null and is dropped.
    const cityCenter = await geocodeCityCenter(googleKey, destination)
    console.log(`[generate-trip] geocodeCityCenter: ${Date.now() - handlerStart}ms elapsed, found=${cityCenter !== null}`)

    // Capped, not Promise.all — see mapWithConcurrency's comment above.
    const VERIFY_CONCURRENCY = 8
    const verified = await mapWithConcurrency(aiPlaces, VERIFY_CONCURRENCY, async (place) => {
      const queries = [place.geocodeQuery, place.geocodeQueryAlt].filter((q): q is string => Boolean(q?.trim()))
      if (queries.length === 0) return null
      const hit = await verifyPlace(googleKey, queries, cityCenter)
      if (!hit) return null
      // Show Google's own matched name, not the AI's — a hallucinated or
      // garbled AI name (confirmed live: "福森號", "COFE 台中州廳") can still
      // fuzzy-match some real nearby place in Google's text search, which
      // gets a real pin but was never actually confirmed to be *that* place.
      // Keeping the AI's label on a Google-verified pin re-opens exactly the
      // "real coordinates, fictional name" gap verification exists to close.
      const verifiedName = hit.name.trim() ? stripBilingualName(hit.name) : place.name
      return { ...place, name: verifiedName, lat: hit.lat, lng: hit.lng, placeId: hit.placeId }
    })
    console.log(
      `[generate-trip] verification: ${Date.now() - handlerStart}ms elapsed, ${verified.filter(Boolean).length}/${aiPlaces.length} verified`,
    )

    // Dedup by Google's placeId, not the AI's name string — independent
    // batches can't see each other's picks, so two differently-worded AI
    // candidates for two different days can both fuzzy-match the SAME real
    // Google place (confirmed live: 一中街 and 忠孝路夜市 each ended up
    // verified onto two separate days of the same trip). placeId is the one
    // signal that's reliable after verification's fuzzy matching resolves
    // identity — a name-based dedup running before verification can't see
    // this collision, because the names being compared haven't been
    // resolved to a canonical place yet. Array order here is batch/day
    // order, so the earlier day wins; the later duplicate is dropped, same
    // as if it had simply failed verification (its day just has one fewer
    // real option to fall back on).
    const seenPlaceIds = new Set<string>()
    const deduped = verified.filter((hit): hit is NonNullable<typeof hit> => {
      if (!hit) return false
      if (seenPlaceIds.has(hit.placeId)) return false
      seenPlaceIds.add(hit.placeId)
      return true
    })

    // Group survivors by their `day` tag and cap each day independently at
    // placesPerDay, in the AI's own confidence order for that day — a bad day
    // can only lose its own places, never anyone else's (see the prompt
    // comment above for why this replaced flat-array slicing). An out-of-
    // range/non-integer day tag is dropped rather than guessed at.
    //
    // Same-day geographic coherence: verification's own city-wide 80km guard
    // (placesVerify.ts) intentionally stays loose, so a legitimate but
    // far-from-downtown zone (大坑, 新社, 清水 海線) still survives — but that
    // means a candidate can be real and in-bounds for the whole CITY while
    // still being impractically far from the OTHER places already accepted
    // for the SAME day (confirmed live: a 大坑 day's food pick resolved to a
    // real branch in 龍井, same city, ~20km away — no day should span that).
    // Anchors on the first (highest-confidence) accepted candidate for each
    // day rather than a separately geocoded zone center, so this costs zero
    // extra Google calls — the coordinates already came back from
    // verification above; a later candidate too far from that anchor is
    // dropped, same as if it had simply failed verification (its day's
    // buffer just has one fewer real option to fall back on).
    const MAX_KM_FROM_DAY_ANCHOR = 12
    const dayAnchors = new Map<number, GeoPoint>()
    const byDay = new Map<number, typeof deduped>()
    // Shared by the initial fill below and the empty-day backfill further
    // down, so a backfilled candidate has to clear the exact same bar
    // (per-day cap, anchor distance, already-used-elsewhere dedup) a
    // first-pass candidate would.
    function tryAcceptHit(hit: (typeof deduped)[number]): boolean {
      if (seenPlaceIds.has(hit.placeId)) return false
      const day = hit.day
      if (!Number.isInteger(day) || day < 1 || day > totalDays) return false
      const dayList = byDay.get(day) ?? []
      if (dayList.length >= placesPerDay) return false

      const anchor = dayAnchors.get(day)
      const hitPoint: GeoPoint = { lat: hit.lat, lng: hit.lng }
      if (anchor) {
        const km = distanceKm(anchor, hitPoint)
        if (km > MAX_KM_FROM_DAY_ANCHOR) {
          console.error(`[generate-trip] day ${day}: dropped "${hit.name}" — ${km.toFixed(1)}km from the day's anchor`)
          return false
        }
      } else {
        dayAnchors.set(day, hitPoint)
      }

      seenPlaceIds.add(hit.placeId)
      dayList.push(hit)
      byDay.set(day, dayList)
      return true
    }
    for (const hit of deduped) tryAcceptHit(hit)

    // A day can come back completely empty even when the trip overall
    // didn't: every candidate for that day failed verification, collided
    // with another day's pick, or — confirmed as the live cause behind a
    // 7-day trip's day 2 coming back empty while day 1 (its batch-mate) was
    // full — a multi-day batch (see MAX_CANDIDATES_PER_CALL above) skewed
    // its own day tagging so one day in the pair got everything and the
    // other got nothing. The per-batch day-tag guard above only force-
    // corrects single-day batches; for a multi-day batch there's no way to
    // tell which candidates were "meant" for the empty day. So instead of
    // guessing, ask again — but as a single-day batch this time, which gets
    // that guaranteed-correct tagging for free (generateSingleDayBatch
    // above). Best-effort and bounded: only runs for the day(s) that came
    // back empty, and only if there's still enough of the 60s function
    // budget left for one more Claude + verification round trip; a day
    // that's still empty after this just stays empty rather than retrying
    // in a loop.
    const BACKFILL_TIME_RESERVE_MS = 18000
    const emptyDays = Array.from({ length: totalDays }, (_, i) => i + 1).filter(
      (day) => (byDay.get(day) ?? []).length === 0,
    )
    if (emptyDays.length > 0 && Date.now() - handlerStart < config.maxDuration * 1000 - BACKFILL_TIME_RESERVE_MS) {
      console.log(`[generate-trip] backfilling empty day(s): ${emptyDays.join(',')}`)
      const BACKFILL_CONCURRENCY = 4
      const backfillBatches = await mapWithConcurrency(emptyDays, BACKFILL_CONCURRENCY, (day) =>
        generateSingleDayBatch(day),
      )
      const backfillCandidates = backfillBatches
        .flat()
        .map((place) => ({ ...place, name: stripBilingualName(place.name) }))
      const backfillVerified = await mapWithConcurrency(backfillCandidates, VERIFY_CONCURRENCY, async (place) => {
        const queries = [place.geocodeQuery, place.geocodeQueryAlt].filter((q): q is string => Boolean(q?.trim()))
        if (queries.length === 0) return null
        const hit = await verifyPlace(googleKey, queries, cityCenter)
        if (!hit) return null
        const verifiedName = hit.name.trim() ? stripBilingualName(hit.name) : place.name
        return { ...place, name: verifiedName, lat: hit.lat, lng: hit.lng, placeId: hit.placeId }
      })
      let backfilled = 0
      for (const hit of backfillVerified) {
        if (hit && tryAcceptHit(hit)) backfilled++
      }
      console.log(
        `[generate-trip] backfill: ${Date.now() - handlerStart}ms elapsed, filled ${backfilled}/${backfillCandidates.length} backfill candidate(s)`,
      )
    }

    const places = Array.from({ length: totalDays }, (_, i) => byDay.get(i + 1) ?? []).flat()

    if (places.length === 0) {
      // Nothing verified — surface as a failure rather than an empty trip,
      // so createTrip()'s hard-fail path shows the retry prompt.
      res.status(502).json({ error: 'No verifiable places' })
      return
    }
    console.log(`[generate-trip] done: ${Date.now() - handlerStart}ms elapsed, returning ${places.length} places`)
    res.status(200).json({ places })
  } catch (error) {
    console.error('generate-trip failed', error)
    res.status(502).json({ error: 'AI generation failed' })
  }
}
