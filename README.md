# TripFlow AI

輸入目的地、天數和旅遊風格，AI 會排出逐日行程，所有景點都經過 Google Places 驗證，確認真實存在。排好的行程放在看板上，可以拖拉調整、自動計算景點之間的交通時間，也能用對話請 AI 幫忙改。

**Demo：** https://tripflow-ai-orcin.vercel.app

## 建議試用路徑

1. **不用等，先看成品：** 打開範本行程 [京都古都慢旅](https://tripflow-ai-orcin.vercel.app/explore/kyoto-slow)，看看看板、地圖和交通時間的呈現。
2. **實際跑一次 AI 生成：** 建立新行程，填目的地和天數。每一天是一個獨立請求並行生成，通常要等一段時間。
3. **在看板上調整：** 拖拉景點換天數或換順序，或打開 AI 對話面板，輸入「幫我把第二天順路排一下」。


## 技術重點

### 1. 兩階段生成，每一天一個獨立請求

```
plan-trip-zones     每個城市一次：Claude 先排每天的區域與主題
      ↓
generate-trip-day   每天一個請求、並行：Claude 產生候選景點 → Google Places 逐筆驗證
      ↓
客戶端              跨天去重、補齊失敗的天、檢查整段失敗
```

最早是整趟行程一次請求，但有兩個問題：耗時隨天數線性增加，會碰到 Vercel function 60 秒上限；AI 偶爾把景點標錯天，導致某一天整天消失，而且偵測不到。拆成一天一個請求後，每個請求只負責一天，天數標記可以強制校正。

各個 serverless invocation 之間沒有共享記憶體，所以去重、補天、失敗判斷都放在客戶端（`src/data/aiTripClient.ts`）統一處理。

### 2. 不讓 AI 編造地點

AI 推薦的每個景點都會拿去 Google Places Text Search 驗證（限定在目的地區域內），查不到就直接丟棄，不會用猜測的座標頂替。因為一定會有一部分被淘汰，prompt 會要求 AI 多給一些候選，並依信心排序。

驗證結果存在 Upstash Redis 快取 90 天。熱門景點（例如清水寺）不管被多少趟行程選到，都只需要驗證一次。

### 3. 失敗就明確失敗

AI 生成失敗時會直接顯示錯誤，**不會悄悄塞一份範本行程**。這個產品的價值就在 AI 排程，默默給一份普通行程，比明確告知失敗更糟。

### 4. Prompt 設計

Prompt 放在 `api/_lib/tripGen.ts`，幾個實際踩過問題之後才加上的規則：

- **定位字串整段只用同一種語言**，並優先用當地官方語言。中文地名接英文城市名，地圖服務幾乎一定配對失敗。
- **停留時數依旅遊風格調整**，例如同樣是淺草寺，走馬看花約 1 小時，逛商店街、抽籤就要 2 到 3 小時。
- **每次請求都相同的規則拆成 system block，並開啟 prompt caching。** 同一趟行程並行的多天請求共用這段快取，重複部分的 input token 成本大幅降低。

## 功能

- AI 逐日行程生成，景點數量依步調（輕鬆／均衡／緊湊）調整，勾選「必吃美食」偏好時每天會包含美食地點
- 多城市行程（最多 8 個城市），由出發日加上每個城市的天數推算結束日
- 看板拖拉排序（跨天移動、同天換順序）
- Leaflet 地圖檢視
- 景點間步行時間估算（經 OpenRouteService），也可以自訂分鐘數；使用者手動設定過的交通時間，重新排序時不會被覆蓋
- AI 對話面板：用 Claude tool use 搬移、刪除、推薦景點，或把整天重新排序
- 手動搜尋新增景點（Google Places 自動完成）
- 列印版行程

## 架構

```
Vue Router + Pages
  ↓
Pinia store: src/stores/trips.ts（唯一狀態來源，直接寫入 localStorage）
  ↓
src/data/ 客戶端層（AI 編排、定位、交通時間、地點搜尋）
  ↓ POST /api/*（金鑰只存在伺服器端）
Vercel Serverless Functions: api/*.ts
  ↓
Claude Sonnet 5 · Google Places API (New) · OpenRouteService · Upstash Redis
```

沒有帳號系統，也沒有後端資料庫，行程資料都存在瀏覽器的 localStorage。

## 技術棧

| 分類 | 使用技術 |
|---|---|
| 前端 | Vue 3（`<script setup>`）、TypeScript、Pinia、Vue Router、VueUse、SCSS |
| 地圖與互動 | Leaflet、vue-draggable-plus |
| 後端 | Vercel Serverless Functions |
| AI 與外部服務 | Anthropic SDK（Claude Sonnet 5）、Google Places API (New)、OpenRouteService、Upstash Redis |
| 測試 | `node:test`（API、資料層、store）、Vitest + Vue Test Utils（元件） |
| CI | GitHub Actions：push 到 main 或開 PR 時，依序跑型別檢查、測試、build |

## 本機開發

```bash
npm install
cp .env.example .env   # 各變數的用途與申請方式寫在檔案註解裡
npm run dev
```

`npm run dev` 只啟動 Vite，不包含 `api/` 的 serverless functions，所以 AI 生成會失敗，這是預期的。要跑完整流程需要部署到 Vercel。

```bash
npm run test              # 型別檢查 + API／資料層／store 測試
npm run test:components   # 元件測試
npm run build             # vue-tsc -b 型別檢查 + 正式 build
```

## 已知限制與下一步

- `src/pages/TripBoardPage.vue` 超過 1300 行，同時處理拖拉、天數管理、時間選擇、交通設定等，目前沒有測試覆蓋。下一步是拆成較小的元件並補上測試。
- 資料只存在單一瀏覽器，換裝置或清除瀏覽資料就會消失。
- localStorage schema 變更時會直接升版號，舊資料失效，沒有 migration。

## 關於文件

- **[CLAUDE.md](CLAUDE.md)：** 目前實作的索引，包含設計決定與背後的取捨。這個專案使用 Claude Code 協作開發，這份文件同時給 AI 和人閱讀，改動影響現況時會一起更新。
- **[docs/](docs/)：** 專案剛啟動時的 v1 初版規劃（PRD、開發計畫、設計筆記），保留作為演進紀錄，**已經不代表現在的實作**。
