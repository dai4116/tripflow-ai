// Shared between api/plan-trip-zones.ts (Stage 1: whole-trip zone/theme
// outline, one call) and api/generate-trip-day.ts (Stage 2: candidate
// generation for a small set of days, one call per request). Splitting
// generation into many small client-orchestrated requests — instead of one
// server-side function looping through the whole trip — is what removes the
// old design's two coupled failure modes: total time scaling with trip
// length (risking Vercel's 60s function limit on long trips) and multi-day
// batches losing a whole day to AI day-tag mistagging with no way to detect
// or correct it after the fact. See each caller for its own reasoning.

const PLACE_CATEGORIES = ['food', 'attraction', 'shopping', 'stay', 'transport', 'other'] as const

// When a candidate is typically/best visited — drives client-side ordering
// (orderDayPlaces in src/data/generateTrip.ts), which places time-of-day
// before geography when sequencing a day: display order becomes clock time
// directly (computeArrivalTimes in placeSchedule.ts starts each day at 08:00
// and cascades forward), so an evening-only spot (a night market, say) has to
// be kept late in the sequence regardless of how close it is to the day's
// other stops. 'anytime' is a real, valid answer (a mall, a general museum)
// — not a stand-in for "the model didn't bother," but the prompt below tells
// the model not to default to it lazily either.
const TIME_OF_DAY_OPTIONS = ['morning', 'afternoon', 'evening', 'anytime'] as const

export const PLACE_SCHEMA = {
  type: 'object',
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          // Which day (1-indexed) this candidate belongs to — the source of
          // truth for day grouping, not array position. A request only ever
          // covers the single day the caller asked for (see `day` on the
          // caller), so this is force-corrected against that value rather
          // than trusted blindly (see generate-trip-day.ts).
          day: { type: 'integer' },
          category: { type: 'string', enum: PLACE_CATEGORIES },
          name: { type: 'string' },
          geocodeQuery: { type: 'string' },
          geocodeQueryAlt: { type: 'string' },
          description: { type: 'string' },
          travelTip: { type: 'string' },
          timeOfDay: { type: 'string', enum: TIME_OF_DAY_OPTIONS },
          // Typical visitor stay length in hours (decimals ok, e.g. 1.5) —
          // drives the day's schedule cascade (computeArrivalTimes in
          // placeSchedule.ts) and the client-side duration-budget trim (see
          // generateTrip.ts) instead of every place getting a flat 1-hour
          // default regardless of what it actually is.
          estimatedTimeHours: { type: 'number' },
        },
        required: ['day', 'category', 'name', 'geocodeQuery', 'description', 'timeOfDay', 'estimatedTimeHours'],
        additionalProperties: false,
      },
    },
  },
  required: ['places'],
  additionalProperties: false,
}

// Stage 1's output shape — a day-by-day theme/area outline for the WHOLE
// trip, decided in one call before any actual places are generated.
// Independent per-day requests (stage 2) can't see each other's picks, so
// without a shared plan they converge on the same handful of famous
// landmarks and produce disjointed, cross-town itineraries day to day. This
// call is cheap (short labels, not full place details), so it can afford to
// look at every day at once.
export const ZONE_SCHEMA = {
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
          // Which of the user's selected interest preferences (verbatim
          // strings, not paraphrased) this day is meant to satisfy — empty
          // array if none. Structured rather than left for the day-generation
          // call to infer from `focus`'s free text: that would chain two
          // separate AI calls' worth of interpretation (this call deciding
          // what a day is "about", a later call guessing what that implies
          // for category selection) instead of stating the requirement
          // plainly. See buildZonePlanPrompt's distribution instruction.
          assignedPreferences: { type: 'array', items: { type: 'string' } },
        },
        required: ['day', 'zone', 'focus', 'assignedPreferences'],
        additionalProperties: false,
      },
    },
  },
  required: ['days'],
  additionalProperties: false,
}

// The one selected travel style (single-select on the form) biases content,
// not just pace — the client already resolves pace/day-window from this same
// style name (see paceForTravelStyles in src/data/generateTrip.ts); this is
// the content half. Kept as a separate copy here rather than a shared
// import: api/ and src/ are independent deployable units, so the style names
// themselves are the only thing that has to stay in sync by hand if the
// option list ever changes.
const STYLE_FLAVOR: Record<string, string> = {
  精準規劃: '偏好效率高、評價好的必去景點，盡量減少繞路移動',
  自在慢旅: '景點數不用多，重視氛圍與步調，不趕行程',
  深度探索: '偏好小眾景點、巷弄與在地生活體驗，避免只選熱門觀光打卡點',
  熱血冒險: '偏好戶外、有挑戰性、新奇的活動與體驗',
}

export function styleFlavorLines(travelStyle: string[] | undefined): string {
  return (travelStyle ?? [])
    .map((style) => STYLE_FLAVOR[style])
    .filter((flavor): flavor is string => Boolean(flavor))
    .join('\n')
}

// Over-ask PER DAY (not once globally): every candidate is verified against
// Google Places and anything unfindable is dropped, then the survivors are
// trimmed to the day's actual time-window budget client-side (see
// generateTrip.ts). Exported — api/generate-trip-day.ts's own server-side
// ceiling is sized against this same constant so the two stay coordinated.
export const PER_DAY_BUFFER = 2

// The one place this "+ PER_DAY_BUFFER" arithmetic is computed, so
// buildDayPrompt's prompt copy and generate-trip-day.ts's server-side accept
// ceiling can't independently drift out of sync with each other.
export function overAskCountFor(targetPlaceCount: number): number {
  return targetPlaceCount + PER_DAY_BUFFER
}

// Mirrors src/data/generateTrip.ts's HARD_MAX_PLACES_PER_DAY — the client's
// duration-budget walk never keeps more than this many places for one day
// regardless of how many verified candidates it received, so
// generate-trip-day.ts's own accept ceiling (see MAX_ACCEPTED_PER_DAY there)
// is capped at this too, rather than only at overAskCountFor's looser
// target-based number — otherwise a packed day's targetPlaceCount (up to 10)
// plus PER_DAY_BUFFER could ship several fully Google-verified candidates
// (each carrying coordinates + a photo ref) that the client would always
// discard unused. Duplicated here rather than imported: api/ and src/ are
// independent deployable units (see e.g. PLACE_CATEGORIES/STYLE_FLAVOR above).
export const CLIENT_HARD_MAX_PLACES_PER_DAY = 7

// The one interest-preference option (see src/data/mockPreferences.ts's
// `preferences` list) that signals the user actually wants food built into
// the itinerary — gates the forced food slot in buildDayPrompt, and is
// excluded from buildZonePlanPrompt's "distribute every preference across at
// least one day" list below since it's already guaranteed EVERY day rather
// than needing an "at least one day" assignment. Pre-selected by default on
// the form, but not hardcoded around: a user who deselects it (or picks a
// food-agnostic travel style like 熱血冒險) shouldn't have a day's place
// burned on a meal they never asked for.
const FOOD_PREFERENCE = '必吃美食'

export type TripContext = {
  destination: string
  travelStyle?: string[]
  preferences?: string[]
  additionalNotes?: string
}

export type ZoneHint = { day: number; zone: string; focus: string; assignedPreferences: string[] }

export type AiPlace = {
  day: number
  category: string
  name: string
  geocodeQuery?: string
  geocodeQueryAlt?: string
  description: string
  travelTip?: string
  timeOfDay?: (typeof TIME_OF_DAY_OPTIONS)[number]
  estimatedTimeHours: number
}

// Loosely typed on purpose — Vercel's Node runtime augments these at runtime
// (req.body parsing, res.status/json helpers) without needing @vercel/node's
// type package. Shared here since both endpoint files need the identical
// shape; api/route.ts and api/ask-ai.ts predate this module and keep their
// own copies rather than being retrofitted to import from trip-gen-specific code.
export type VercelLikeRequest = {
  method?: string
  body?: unknown
  // Real Node IncomingMessage method — used to detect the client giving up
  // so an in-flight Claude/Google call can be cancelled instead of paying
  // for work nobody will read the result of.
  on?: (event: 'close', listener: () => void) => void
}
export type VercelLikeResponse = {
  status: (code: number) => VercelLikeResponse
  json: (body: unknown) => void
}

// Shared request-shape validation for both endpoints — each has its own
// additional fields to validate beyond these two, but destination/totalDays
// are common to both and were previously copy-pasted identically in each file.
export function validateDestination(destination: unknown): destination is string {
  return typeof destination === 'string' && destination.length > 0
}

export function validateTotalDays(totalDays: unknown): totalDays is number {
  return Number.isInteger(totalDays) && (totalDays as number) >= 1 && (totalDays as number) <= 30
}

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

// Only api/generate-trip-day.ts's windowStart/windowEnd use this — both are
// only ever produced client-side by dayWindowForPace/windowForFlightDay
// (always valid, always ordered), so a real client never fails this. Exists
// as a defensive check at the network boundary, so a malformed or reversed
// window degrades to a clear 400 instead of silently flowing into the AI
// prompt as-is.
export function validateTimeWindow(windowStart: unknown, windowEnd: unknown): boolean {
  if (typeof windowStart !== 'string' || typeof windowEnd !== 'string') return false
  if (!HHMM_PATTERN.test(windowStart) || !HHMM_PATTERN.test(windowEnd)) return false
  return windowStart < windowEnd
}

// Runs `fn` over `items` with at most `limit` in flight at once. A small
// worker pool keeps genuine parallelism without dumping every call on the
// sandbox/browser at once, which queues rather than truly parallelizes (and,
// for the Claude/Google calls this wraps, risks bursting past account-level
// rate limits).
//
// Contract: `fn` must never throw — if it can fail, it must catch its own
// error and resolve to a sentinel (null/undefined/[]) instead. A thrown
// error still aborts the whole batch via Promise.all below (this logs it
// first so the culprit is identifiable, but does not change that outcome),
// discarding every other in-flight worker's results — every current caller
// upholds this by design (see e.g. verifyPlace's and requestDay's own "never
// throws" comments); a future caller that doesn't will silently reintroduce
// exactly the "one bad candidate takes out every other one" failure mode
// this whole per-day-request split was built to eliminate.
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    for (;;) {
      const i = nextIndex++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i]!)
      } catch (error) {
        console.error('[mapWithConcurrency] fn threw — this violates its no-throw contract and aborts the whole batch', error)
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export function buildZonePlanPrompt(ctx: TripContext, totalDays: number): string {
  // FOOD_PREFERENCE excluded — see its own comment for why (guaranteed every
  // day already, doesn't need an "at least one day" assignment here).
  const distributablePreferences = (ctx.preferences ?? []).filter((preference) => preference !== FOOD_PREFERENCE)
  return [
    `目的地：${ctx.destination}`,
    ctx.travelStyle?.length ? `旅遊風格：${ctx.travelStyle.join('、')}` : '',
    styleFlavorLines(ctx.travelStyle),
    ctx.preferences?.length ? `興趣偏好：${ctx.preferences.join('、')}` : '',
    ctx.additionalNotes
      ? `其他補充需求：${ctx.additionalNotes}（可能是想避開的地方，也可能是其他偏好或限制，請依內容判斷並納入行程考量）`
      : '',
    '',
    `請先幫我規劃一趟共 ${totalDays} 天行程的「每日主題與區域」大綱——還不用列出具體景點，只需要決定每天要去哪個區域、聚焦什麼主題。`,
    `請通盤考慮全部 ${totalDays} 天：每天的區域/主題都要不一樣，不要讓同一個知名景點或商圈在兩天的主題描述裡都出現。`,
    '主題請有變化，混合市區文化商圈、老街/夜市、自然景觀與近郊景點、歷史建築等不同類型——不要每天都侷限在市中心最知名的那幾個地方，也請適度考慮比較不那麼觀光客爆滿、但確實存在且值得一去的近郊區域。',
    distributablePreferences.length
      ? `以下每一個興趣偏好都請至少分配到一天：${distributablePreferences.join('、')}。請把每個偏好指派給主題/區域最適合它的那一天（例如「逛街購物」指派給有商圈的那天、「自然秘境」指派給近郊/自然景觀的那天），並在該天的 assignedPreferences 欄位填入對應的偏好文字（必須用原字串，不要改寫或翻譯）。天數比偏好數量多時，沒被指派偏好的天可以自由發揮、assignedPreferences 填空陣列；天數比偏好數量少時，允許同一天指派多個偏好。`
      : '',
    '如果天數較多，可以把地理上相近的主題安排在相鄰的天數，讓整體動線比較順；不用嚴格照順序，但盡量避免同一趟行程在城市各角落之間跳來跳去。',
    `每天請給一個簡短的「區域/主題」名稱（zone，例如「草悟道／勤美文青核心區」），和一句「聚焦內容」的簡短說明（focus，例如「文創園區、咖啡廳、老屋改造」）。用 day 欄位標明第幾天（1 到 ${totalDays} 的整數），並填寫 assignedPreferences 欄位（沒有指派偏好就填空陣列 []）。`,
  ]
    .filter(Boolean)
    .join('\n')
}

// Builds the prompt for a single request's single day (see the no-batching
// rationale in aiTripClient.ts — every request covers exactly one day, which
// is what lets the caller force-correct the AI's day tag with certainty).
// zoneHint carries whatever stage-1 theme label is available for this day;
// missing (stage 1 failed, or didn't cover this day) just produces no zone
// line, same as the old best-effort fallback.
export function buildDayPrompt(
  ctx: TripContext,
  day: number,
  totalDays: number,
  targetPlaceCount: number,
  // The day's active-hours window ('HH:mm') — replaces the old flat
  // exact-count target: instead of always asking for N places, the model is
  // told how much of the day it's filling and asked to size its own
  // suggestion count so each place's estimatedTimeHours (plus rough travel)
  // roughly fills, without badly overshooting, this window. See
  // src/data/generateTrip.ts's dayWindowForPace/windowForFlightDay for how
  // this is computed client-side.
  windowStart: string,
  windowEnd: string,
  zoneHints: ZoneHint[],
  // Only meaningful (and only ever passed) for the day a flight actually
  // affects — day 1's arrivalTime, the trip's last day's departureTime,
  // both for a one-day trip with both set. aiTripClient.ts's requestDay
  // already narrows the window for that day (see windowForFlightDay in
  // src/data/generateTrip.ts); these just steer WHICH candidates make sense
  // in the shortened window, e.g. not a sunrise-market pick when arrival is
  // mid-afternoon.
  arrivalTime?: string,
  departureTime?: string,
): string {
  const overAskCount = overAskCountFor(targetPlaceCount)
  const hint = zoneHints.find((entry) => entry.day === day)
  const zoneLine = hint ? `第${day}天主題：「${hint.zone}」——${hint.focus}` : ''
  // Stage 1 already decided WHICH preferences this day should satisfy (and
  // picked a zone/focus compatible with them — see buildZonePlanPrompt) —
  // this states it plainly rather than expecting the model to re-derive
  // "logic implies shopping" from the zoneLine's free-text focus a second
  // time in this separate call.
  const assignedPreferencesLine = hint?.assignedPreferences?.length
    ? `今天請至少包含 1 個符合以下偏好的地點：${hint.assignedPreferences.join('、')}。`
    : ''
  const flightConstraintLine =
    arrivalTime && departureTime
      ? `注意：這天旅客要到當地時間 ${arrivalTime} 才抵達，而且同一天 ${departureTime} 就要離開（入境+離境都在這天），實際可用時段非常短，請只推薦真正配合得上這個時間窗、方便銜接的候選，timeOfDay 請據實填寫，不要硬湊候選數。`
      : arrivalTime
        ? `注意：這是行程第一天，旅客要到當地時間 ${arrivalTime} 才會抵達目的地（扣除入境與往返市區的時間，實際能開始遊覽會再晚一點），請不要推薦上午/清晨才適合的候選（例如早市、日出景點），timeOfDay 請據實填寫成這個候選實際適合的時段。`
        : departureTime
          ? `注意：這是行程最後一天，旅客當地時間 ${departureTime} 就要出發前往機場，實際可遊覽時間會提早結束，請避免推薦太晚、太遠、或只適合傍晚以後才去的候選（例如夜市、酒吧、夜景、限定晚餐的餐廳），timeOfDay 請據實填寫。`
          : ''
  const wantsMealSlots = ctx.preferences?.includes(FOOD_PREFERENCE) ?? false
  return [
    `目的地：${ctx.destination}`,
    ctx.travelStyle?.length ? `旅遊風格：${ctx.travelStyle.join('、')}` : '',
    styleFlavorLines(ctx.travelStyle),
    ctx.preferences?.length ? `興趣偏好：${ctx.preferences.join('、')}` : '',
    ctx.additionalNotes
      ? `其他補充需求：${ctx.additionalNotes}（可能是想避開的地方，也可能是其他偏好或限制，請依內容判斷並納入行程考量）`
      : '',
    '',
    // This call only covers a slice of the trip (its own day) — told
    // explicitly so the model doesn't try to pace itself as if this were the
    // whole itinerary.
    `這是一趟共 ${totalDays} 天行程裡的第 ${day} 天。請只規劃這一天，每個景點都要用 day 欄位標明為 ${day}。這天的活動時間大約是 ${windowStart} 到 ${windowEnd}，請抓大概 ${overAskCount} 個景點候選（含備援，見下方說明）。`,
    zoneLine
      ? `以下是已經先規劃好的當日主題，請在指定的區域/主題範圍內挑選具體、確實存在的地點，不要跳出這個主題去選其他區域的景點：\n${zoneLine}`
      : '',
    assignedPreferencesLine,
    flightConstraintLine,
    `每一天請提供最多 ${overAskCount} 個候選景點——比這天大概抓的 ${targetPlaceCount} 個多 ${PER_DAY_BUFFER} 個，多出來的是備援（見下方說明）。${targetPlaceCount} 這個數字只是「這天大概能塞下幾個景點」的粗估，不是精確目標；實際會採用幾個，之後會依每個地點的 estimatedTimeHours 與這天的時間窗另外篩選決定，不是由你決定最終留幾個——所以請放心，只管照下面的說明給滿 ${overAskCount} 個候選就好。同一天的候選請依你的信心排序，越有把握、越具體明確的排越前面。`,
    wantsMealSlots
      ? `每一天的候選景點裡，請至少包含一個美食類地點（分類 food，適合當午餐或晚餐皆可），其餘搭配景點、購物、住宿等不同類型——不用強求午餐、晚餐都各自安排一個，一天有一個吃的就好，把名額留給這天的其他主題/偏好。`
      : '這趟行程沒有特別要求美食類地點，請完全依旅遊風格與興趣偏好決定每天的地點類型組成，不用刻意安排美食地點——如果某個地點剛好符合風格或偏好、恰好是美食類也可以，但不要為了湊「每天都要有吃的」而特地加入。',
    `重要：我們會把每個候選拿去真實地圖（Google 地圖）逐一驗證，查不到的直接丟棄；剩下的候選也會再依每個地點的 estimatedTimeHours 與這天的時間窗篩選一次，太晚超出時間窗的候選可能不會被採用。所以每一天請務必自己給滿 ${overAskCount} 個候選，不要因為某天景點少就少給——同一天的備援只會遞補同一天被丟棄的名額，不會被其他天借用。另外請「只」推薦你有把握真實存在、地圖上找得到的『具體、明確』地點——寧可某天候選數不足，也不要放模糊的類別式名稱（例如「清水在地小吃」「中信市場美食」這種不是特定店家/地標的名稱）或你不確定是否存在的名稱。`,
    '每個景點包含分類、名稱、一句簡短描述（繁體中文），以及可選的一句實用小提示（travelTip）。',
    '另外每個景點都要填 timeOfDay 欄位，標示這個地點通常/最適合什麼時段前往：morning（適合上午，例如市場、日出景點）、afternoon（適合下午，沒有明顯時段限制的多數景點也可以用這個）、evening（只適合晚上或傍晚以後，例如夜市、酒吧、夜景、只供應晚餐的餐廳）、anytime（真的完全不受時段限制，例如大型商場、一般博物館）。請依你對這個地點的實際了解判斷，不要每個都填同一個值敷衍——這個欄位會直接影響行程排序與顯示時間。',
    '每個景點也請填 estimatedTimeHours 欄位——一般遊客實際會在這個地點停留的時數（可以有小數，例如 1.5），只算停留時間本身，不用算進交通時間。請依地點的實際性質估算，不要每個都填同一個數字：地標、拍照打卡點約 0.5-1 小時；一般博物館、公園、商圈約 1.5-3 小時；一餐飯約 1-1.5 小時；大型主題樂園或超大型展館可以到 4 小時以上。',
    '名稱優先使用繁體中文慣用名稱，不要同時附上英文原文或重複的括號翻譯（例如寫「洽圖洽週末市場」，不要寫「Chatuchak Weekend Market（洽圖洽週末市場）」）。若沒有通行的繁體中文名稱，或外文是官方品牌名稱，請保留官方名稱；分店、分校、校區等必要辨識資訊可用繁體中文括號註明（例如「Wall Street English（信義分校）」）。',
    '另外提供 geocodeQuery 欄位：這是給地圖服務（OpenStreetMap）查詢定位用的完整字串，不會顯示給使用者。格式必須是「地點官方名稱, 城市, 國家」，三段全部使用同一種語言，而且優先使用當地官方語言（地圖資料庫幾乎都是用當地語言登記地點名稱，翻成英文常常查不到、或誤配到完全不相關的地方）；只有目的地本身是英語系國家，或這個地點是國際連鎖品牌、慣用英文名稱時，才用英文。絕對不要中文和其他語言混用在同一個 geocodeQuery 裡。例如目的地是義大利佛羅倫斯，應填寫「Galleria degli Uffizi, Firenze, Italia」（義大利文），不要翻成「Uffizi Gallery, Florence, Italy」；目的地是韓國釜山，應填寫「부산시립미술관, 부산, 대한민국」（韓文），不要翻成「Busan Museum of Art, Busan, South Korea」。只有目的地本身是華語地區時，才整段使用中文（例如「九份老街, 新北市, 台灣」）。',
    '如果不確定這個地點在地圖服務上的正式登記名稱（例如是複合式建築、市場、商圈，官方全名可能跟通俗說法不同），請額外提供 geocodeQueryAlt 欄位，格式同 geocodeQuery，但改用更簡短、更通用的常見說法（例如 geocodeQuery 是「Mercato Centrale di San Lorenzo, Firenze, Italia」，geocodeQueryAlt 可以是「Mercato Centrale, Firenze, Italia」），作為查詢失敗時的備援；有把握的話可以不用提供這個欄位。另一種常見狀況是地點名稱本身已經把城市名黏在前面（例如「부산영화체험박물관」），這種寫法常常查不到，這時 geocodeQueryAlt 請把城市名從地點名稱裡拿掉、只留給城市那個欄位（例如寫成「영화체험박물관, 부산, 대한민국」）。',
    '只推薦你有信心真實存在的景點，不要為了湊類型或數量而生造出聽起來像正式機構、但你不確定是否存在的名稱（例如自己組合出一個「XX博物館」）。不確定某個細分機構是否存在時，請改推薦你比較有把握的知名地標，或是更廣義但確實存在的地點（例如某商圈、某條老街），不要用一個可能不存在的專有名稱硬湊。',
    '不要編造具體的評分、地址或經緯度——只需要景點名稱與描述建議即可。',
  ]
    .filter(Boolean)
    .join('\n')
}
