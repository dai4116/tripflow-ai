# TripFlow AI

AI 排程的旅遊行程規劃工具：使用者輸入目的地/天數/風格，AI（Claude Sonnet 5 + Google Places 驗證）生成逐日行程，使用者在看板上拖拉調整、串連交通時間。Vue 3 + TypeScript + Pinia，資料全存在瀏覽器 localStorage（沒有帳號系統、沒有後端資料庫）。

`docs/prd.md`、`docs/development-plan.md`、`docs/design-notes.md` 是專案剛啟動時寫的 v1 初版規劃，**現況已經演進很多，不要當成現行規格參考**（例：PRD 把 Google Places API 列為 out of scope，現在它是 AI 生成管線的核心）。這份 CLAUDE.md 才是現況索引——**改動了會影響現況的東西，記得回來補一行**，這比任何正式流程都重要。

`README.md` 裡面寫了 Places 快取 90 天、多城市上限、TripBoardPage 行數等具體細節。**改到這些東西時 README 也要跟著改**，不然對外文件會跟實作不一致。三份 v1 docs 開頭也各加了一段「不代表目前實作」的提醒。

## 開發指令

- `npm run dev` — Vite dev server（沒有 serverless functions，AI 生成會直接失敗，這是預期行為）
- `npm run build` — **必須用 `vue-tsc -b`**（見下方協作慣例），不是 `--noEmit -p tsconfig.json`，後者在這個 solution-style root config 下會靜默 no-op
- `npm run test` — 型別檢查（api / data 兩個 tsconfig）+ `node --test` 跑 `api/`、`src/data`、`src/stores`、`src/composables` 的邏輯層測試
- `npm run test:components` — `vitest run`，元件層測試
- CI（`.github/workflows/ci.yml`）在 push 到 main 與開 PR 時自動跑「`npm run test` → `npm run test:components` → `npm run build`」，任一步失敗就擋下。本機改完仍建議先手動跑過，不要只靠 CI 事後才發現

## 環境變數（詳見 `.env.example`）

| 變數 | 用途 | 未設定時的行為 |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI 生成（Claude） | 生成硬失敗，無 fallback |
| `GOOGLE_PLACES_API_KEY` | 地點驗證/座標/照片/自動完成 | 退回舊的 Nominatim 路徑，可能定位不到或定位錯 |
| `OPENROUTESERVICE_API_KEY` | 交通時間估算（經 `/api/route` 代理） | 交通時間功能不可用 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis：`api/_lib/placesVerify.ts` 跨 function 快取已驗證地點 90 天；`api/place-photo.ts`（經 `api/_lib/kv.ts`）另外快取已解析的照片轉址網址 50 分鐘、過期/無效 photoRef 5 分鐘；同一組 Redis 也存 `api/_lib/rateLimit.ts` 的配額計數器 | 三邊都退回「不快取／不設限」，不會壞掉——配額退回 unlimited，見下方 |
| `ADMIN_DASHBOARD_SECRET` | 後台使用量頁 `/admin/usage`（`api/admin/usage.ts`）的存取密鑰，前端存 **sessionStorage**（不是 localStorage——關掉分頁/瀏覽器就清掉，縮短明碼曝露時間，見 `adminUsageClient.ts` 註解）、經 `X-Admin-Secret` header 送出 | 端點直接 500 拒絕所有請求，不會退回「無密鑰也能看」 |

## 免費額度保護（配額機制）

面試期間怕 `$ANTHROPIC_API_KEY` 額度被打爆而做的三層配額，2026-08 上線：`api/_lib/rateLimit.ts` 的 `checkRateLimit`/`enforceRateLimit`，每次 Claude 呼叫前檢查（絕不在呼叫後才檢查）。

- 三層：單一訪客 10 分鐘內次數、單一訪客當日次數、**全站當日次數**（真正的成本防線，跟訪客識別無關，砍不掉）。訪客身分是 `src/data/visitorId.ts` 存在 localStorage 的隨機 id（不是帳號、不是 IP），完全可被無痕視窗繞過，這是刻意接受的取捨——這層本來就不是防駭客，是防單一訪客/單一 session 失控
- 擋下時一律回一句通用訊息「目前使用量較高，請稍後再試」，不透露是哪一層擋的、不承諾等多久，前端也不顯示剩餘額度給訪客看
- `plan-trip-zones.ts` 是「每城市群組一次」不是「每趟行程一次」——多城市行程（`CreateTripPage.vue` 的 `MAX_CITIES = 8`）一次建立最多發 8 個請求，配額數字已經照這個抓（10 分鐘 10 次／每日 20 次），改配額前先看這支檔案開頭註解，不要用「一次呼叫=一次操作」的直覺去抓數字
- 表單上單趟行程最長 `MAX_TRIP_DAYS = 10` 天（定義在 `src/data/generateTrip.ts`，`CreateTripPage.vue` import 過去用，**不要在頁面裡另外宣告一份**），2026-09 從 30 降到 10，是面試期間控制預付額度消耗的取捨。**這只是前端表單的限制，`api/_lib/tripGen.ts` 的 `validateTotalDays` 還是接受 1~30 天**——只調前端這個常數不會真的降低有人直接打 API 的花費，那道防線是上面的全站當日配額，不是這裡
- `generate-trip-day.ts`（真正花錢的那支）只有**全站當日**配額（`globalPerDay: 200`），刻意不設單一訪客限制——同一趟多天行程的每一天是平行打不同請求，訪客層級限制會有「同一趟行程有些天被擋、有些天沒被擋」的風險
- 全域計數器 TTL 拉到 60 天（不是當天就過期）——這是刻意的，讓 `/admin/usage` 能回顧歷史用量；單一訪客層級的計數器沒有這樣做，維持當天就過期，避免留存不必要的個人使用足跡
- `plan-trip-zones` 失敗（含被擋）會 throw `RateLimitedError` 並讓整個建立行程流程中止，跟其他「失敗就靜默略過、繼續生成」的錯誤處理方式不同——這是刻意的例外，理由見 `aiTripClient.ts` 裡 `planZones` 的註解
- 配額算的是**次數**不是 token，所以 2026-09 另外加了 `api/_lib/inputLimits.ts`：所有會插進 prompt 的欄位（destination、additionalNotes、偏好陣列、航班時間、ask-ai 的 message 與 columns）都有長度或格式上限，超過回 400。前端表單有對應的 `maxlength`（常數在 `generateTrip.ts`、`askAiClient.ts`，跟後端手動同步），**一律是後端上限的一半，不能相等**：自動完成是用程式寫入欄位，手機注音輸入法組字也可能不受 maxlength 限制，而 `generate-trip-day` 回 400 會讓整趟生成失敗。`zones`（AI 自己產生的文字）和 ask-ai 的地點名稱（看板上能存任意長度）刻意截斷而不是拒絕（見 `tripGen.ts` 的 `sanitizeZoneHints`、`inputLimits.ts` 的 `MAX_PLACE_NAME_LENGTH`）

## 系統分層

```
Vue Router + Pages
  ↓ actions
Pinia store — src/stores/trips.ts（唯一狀態來源，useStorage 直寫 localStorage）
  ↓
data/ 客戶端層（aiTripClient / generateTrip / geocode / routing / placesSearchClient ...）
  ↓ POST /api/*（藏金鑰）              ↘ 例外：geocode.ts 直連 Nominatim（免金鑰，見下）
Vercel Serverless — api/*.ts
  ↓
Claude Sonnet 5 · Google Places API (New) · OpenRouteService（經代理）· Upstash Redis
```

Google Places 一律經 `api/` 代理（藏 key）；Nominatim 因不需要金鑰，是唯一一條瀏覽器直連外部服務的路徑，只服務「還沒有座標」的地點（見下方地理定位）。

## 資料模型與 localStorage 版本化

`src/types/index.ts`：`Trip` / `TripColumn` / `Place` 三個核心型別。存在 `useStorage('tripflow-trips-vN', ...)` / `tripflow-places-vN`（`src/stores/trips.ts` 開頭）。

- schema 改變就手動 bump 版本號，**舊資料直接失效變空，沒有 migration 腳本**
- `trips` 和 `places` 永遠一起 bump，即使只有一邊 schema 真的變了（避免孤兒資料）
- 新欄位如果每個讀取點都已對 `undefined` 安全，可以不 bump（例：`coverPhotoRef`）
- 目前版本、演進歷史見 `trips.ts` 該行上方註解

## AI 生成管線（複雜度最高的一段）

`src/data/aiTripClient.ts` → `api/plan-trip-zones.ts`（每城市群組一次，Claude 排每日主題）→ `api/generate-trip-day.ts`（**每一天一個獨立請求**，Claude 生成候選 + Google Text Search 逐筆驗證）。

- 一天一請求是刻意設計（取代舊的整趟一次式），原因：舊設計耗時隨天數線性增加、有撞 Vercel 60s 上限的風險，且 AI 曾在同批次把某天標錯導致整天遺失且無法偵測
- 跨天去重（`dedupeByPlaceId`）、補天（`daysNeedingBackfill`）、整段失敗檢查（`failedSegment`）都在**客戶端**做——獨立 serverless invocation 之間沒有共享記憶體
- **AI 生成失敗會直接 throw，不會靜默退回範本資料**（`trips.ts` createTrip 的刻意決定）：這個 app 的賣點就是 AI 排程，悄悄塞一個普通行程會是更糟的失敗。改這段邏輯前務必想清楚這個 trade-off
- 地點數量由 pace 決定（relaxed/balanced/packed）。美食地點**只有勾選「必吃美食」偏好時**才強制每天至少一個（表單預設勾選，取消就不排），見 `api/_lib/tripGen.ts` 的 `FOOD_PREFERENCE` 註解

## 地理定位：兩條路徑，不要搞混

- **主要路徑**：AI 生成當下，`api/_lib/placesVerify.ts` 用 Google Places Text Search 驗證，驗證不過就丟棄候選，不會用猜測值頂替
- **備援路徑**：`src/data/geocode.ts`，只用在手動新增地點、或沒設定 `GOOGLE_PLACES_API_KEY` 時，直連 Nominatim（1 req/s 佇列），**永遠回傳「最佳猜測」而非「找不到」**
- **絕不把不同語言的字串拼進同一個 Nominatim 查詢**（例：中文地名硬接英文城市名）——會直接破壞比對，之前踩過這個雷

## 已知的設計決定（不是 bug，review 時不要當成要修的東西）

- `Place` 沒有區分「使用者手動輸入時間」跟「系統自動算的時間」——這是刻意的
- 多目的地行程用「出發日 + 每城天數」推導結束日（2026-08-09 定案的方案），`TripColumn.cityId` 標記每個看板欄屬於哪個城市
- `TravelToNext.auto` 區分系統自動估的交通時間跟使用者手動選的——reorder 時只覆蓋前者，不動使用者的選擇

## 複雜度熱點（改這些之前多留意）

- `src/pages/TripBoardPage.vue`（1300+ 行）——同時處理拖拉排序、天數管理、地點抽屜、時間選擇器、交通 modal、行程設定、鍵盤事件，**目前零測試覆蓋**，是全案風險最集中的檔案
- `src/data/generateTrip.ts`（850+ 行）、`src/data/aiTripClient.ts`——AI 管線的組裝/編排邏輯，有測試但邏輯密度高
- 這幾個檔案改動前，建議先看對應的 `.test.ts`，改完務必重跑

## 協作慣例

- 回覆用繁體中文
- git push 之前一定要先問過，即使先前同意過一次，之後每次都要重新確認
- 動到資料模型、AI 生成管線、或 localStorage 版本號的改動，先跑一次 code review 當第二意見再上
- 沒有 PR review 這關，目前是直接 commit 到 main——這是已知的流程缺口，不是要你在這裡補齊，只是讓你知道現況
