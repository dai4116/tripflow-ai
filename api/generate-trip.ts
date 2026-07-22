import Anthropic from '@anthropic-ai/sdk'
import { stripBilingualName } from './_lib/placeName.js'
import { geocodeCityCenter, verifyPlace } from './_lib/placesVerify.js'

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
  travelStyle?: string
  preferences?: string[]
  avoidPlaces?: string
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
  // sum of all of them.
  const MAX_CANDIDATES_PER_CALL = 20
  const daysPerBatch = Math.max(1, Math.floor(MAX_CANDIDATES_PER_CALL / perDayCandidates))
  const dayBatches: number[][] = []
  for (let start = 1; start <= totalDays; start += daysPerBatch) {
    const end = Math.min(start + daysPerBatch - 1, totalDays)
    dayBatches.push(Array.from({ length: end - start + 1 }, (_, i) => start + i))
  }

  function buildPrompt(dayNumbers: number[]): string {
    const dayList = dayNumbers.join('、')
    const batchRequestCount = dayNumbers.length * perDayCandidates
    return [
      `目的地：${destination}`,
      `旅遊風格：${travelStyle || '文化'}`,
      preferences?.length ? `興趣偏好：${preferences.join('、')}` : '',
      avoidPlaces ? `想避開：${avoidPlaces}` : '',
      '',
      // This call only covers a slice of the trip (its own batch of days) —
      // told explicitly so the model doesn't try to pace itself as if this
      // were the whole itinerary.
      `這是一趟共 ${totalDays} 天行程裡的第 ${dayList} 天。請只規劃這幾天，每個景點都要用 day 欄位標明屬於第幾天（必須是 ${dayList} 其中之一），總共推薦約 ${batchRequestCount} 個景點候選。`,
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
        return parsed.places ?? []
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
    // matches how the map provider indexes the place. Dedup by name: separate
    // batches can't see each other's picks, so the same landmark occasionally
    // gets suggested for two different days — drop the later duplicate rather
    // than spend a verification call and a day's slot on a place that already
    // appears earlier in the trip.
    const seenNames = new Set<string>()
    const aiPlaces = batchResults
      .flat()
      .map((place) => ({ ...place, name: stripBilingualName(place.name) }))
      .filter((place) => {
        const key = place.name.trim().toLowerCase()
        if (!key || seenNames.has(key)) return false
        seenNames.add(key)
        return true
      })
    console.log(`[generate-trip] parsed ${aiPlaces.length} candidates after dedup, ${Date.now() - handlerStart}ms elapsed`)

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
      return hit ? { ...place, lat: hit.lat, lng: hit.lng, placeId: hit.placeId } : null
    })
    console.log(
      `[generate-trip] verification: ${Date.now() - handlerStart}ms elapsed, ${verified.filter(Boolean).length}/${aiPlaces.length} verified`,
    )

    // Group survivors by their `day` tag and cap each day independently at
    // placesPerDay, in the AI's own confidence order for that day — a bad day
    // can only lose its own places, never anyone else's (see the prompt
    // comment above for why this replaced flat-array slicing). An out-of-
    // range/non-integer day tag is dropped rather than guessed at.
    const byDay = new Map<number, NonNullable<(typeof verified)[number]>[]>()
    for (let i = 0; i < aiPlaces.length; i++) {
      const hit = verified[i]
      if (!hit) continue
      const day = aiPlaces[i]!.day
      if (!Number.isInteger(day) || day < 1 || day > totalDays) continue
      const dayList = byDay.get(day) ?? []
      if (dayList.length >= placesPerDay) continue
      dayList.push(hit)
      byDay.set(day, dayList)
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
