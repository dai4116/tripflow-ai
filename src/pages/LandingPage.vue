<template>
  <div class="landing-page">
    <section class="landing-hero">
      <div class="landing-hero__copy">
        <StatusBadge><AppIcon name="sparkle" :size="12" /> AI 驅動・搶先體驗中</StatusBadge>
        <h1>用 AI 規劃行雲流水般的旅程。</h1>
        <p>
          描述你夢想中的旅程，TripFlow AI 會建立看板式行程、
          把每個景點標在地圖上，並隨著你的探索即時調整。
        </p>
        <div class="landing-hero__actions">
          <BaseButton :to="{ name: 'trip-create' }"><AppIcon name="sparkle" :size="15" /> 規劃我的行程</BaseButton>
          <BaseButton :to="{ name: 'dashboard' }" variant="secondary">查看首頁 <AppIcon name="arrow-right" :size="14" /></BaseButton>
        </div>
        <div class="landing-hero__trust">
          <span><AppIcon name="check" :size="12" /> 免費開始使用</span>
          <span><AppIcon name="check" :size="12" /> 免信用卡</span>
          <span><AppIcon name="check" :size="12" /> AI 自動生成</span>
        </div>
      </div>

      <div class="product-preview" aria-label="TripFlow 產品預覽">
        <div class="product-preview__header">
          <div>
            <strong>東京探索之旅</strong>
          </div>
        </div>
        <div class="product-preview__board">
          <div v-for="column in previewColumns" :key="column.title" class="product-preview__column">
            <div class="product-preview__column-head">
              <strong>{{ column.title }}</strong>
            </div>
            <div v-for="(place, index) in column.places" :key="place.name" class="product-preview__mini-card">
              <span class="product-preview__mini-card-thumb" :style="{ background: place.gradient }">
                <span class="product-preview__mini-card-index">{{ index + 1 }}</span>
              </span>
              <span class="product-preview__mini-card-body">
                <span class="product-preview__mini-card-top">
                  <CategoryChip :category="place.category" icon-only />
                  <span class="product-preview__mini-card-time">{{ place.time }}</span>
                </span>
                <strong>{{ place.name }}</strong>
                <small><AppIcon name="clock" :size="9" />停留 {{ place.duration }}</small>
              </span>
            </div>
          </div>
        </div>
        <div class="product-preview__map">
          <span
            v-for="pin in previewPins"
            :key="pin.label"
            class="product-preview__map-pin"
            :style="{ top: pin.top, left: pin.left, background: pin.color }"
          >{{ pin.label }}</span>
        </div>
      </div>

      <div class="landing-mobile-preview" aria-label="TripFlow 產品預覽">
        <div class="landing-mobile-preview__header">
          <strong>東京探索之旅</strong>
        </div>
        <div class="landing-mobile-preview__tabs">
          <span
            v-for="(column, index) in previewColumns"
            :key="column.title"
            class="landing-mobile-preview__tab"
            :class="{ 'landing-mobile-preview__tab--active': index === 0 }"
          >{{ column.title }}</span>
        </div>
        <div class="landing-mobile-preview__cards">
          <div
            v-for="(place, index) in mobilePreviewPlaces"
            :key="place.name"
            class="product-preview__mini-card"
          >
            <span class="product-preview__mini-card-thumb" :style="{ background: place.gradient }">
              <span class="product-preview__mini-card-index">{{ index + 1 }}</span>
            </span>
            <span class="product-preview__mini-card-body">
              <span class="product-preview__mini-card-top">
                <CategoryChip :category="place.category" icon-only />
                <span class="product-preview__mini-card-time">{{ place.time }}</span>
              </span>
              <strong>{{ place.name }}</strong>
              <small><AppIcon name="clock" :size="9" />停留 {{ place.duration }}</small>
            </span>
          </div>
        </div>
      </div>
    </section>

    <section id="features" class="landing-section" aria-label="功能特色">
      <div class="landing-section__header">
        <h2>聰明旅行所需的一切</h2>
        <p>從發想靈感到登機門，TripFlow AI 幫你搞定所有繁瑣細節。</p>
      </div>

      <div class="section-grid">
        <BaseCard v-for="feature in features" :key="feature.title">
          <StatusBadge tone="accent"><AppIcon :name="feature.icon" :size="13" /></StatusBadge>
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.description }}</p>
        </BaseCard>
      </div>
    </section>

    <section id="workflow" class="landing-section landing-section--white" aria-label="使用流程">
      <div class="landing-section__header">
        <h2>幾分鐘內從點子變成完整行程</h2>
      </div>

      <div class="workflow-list">
        <article v-for="step in workflow" :key="step.title" class="workflow-step">
          <strong>{{ step.number }}</strong>
          <div>
            <h3>{{ step.title }}</h3>
            <p>{{ step.description }}</p>
          </div>
        </article>
      </div>
    </section>

    <section class="landing-section" aria-label="使用者評價">
      <div class="testimonial-grid">
        <BaseCard v-for="testimonial in testimonials" :key="testimonial.name" class="testimonial-card">
          <span class="testimonial-card__stars">
            <AppIcon v-for="n in 5" :key="n" name="star" :size="13" />
          </span>
          <p>“{{ testimonial.quote }}”</p>
          <div>
            <strong>{{ testimonial.name }}</strong>
            <small>{{ testimonial.role }}</small>
          </div>
        </BaseCard>
      </div>
    </section>

    <section class="landing-cta">
      <h2>準備好迎接下一場旅程了嗎？</h2>
      <p>加入數千名用 TripFlow AI 聰明規劃行程的旅人。</p>
      <BaseButton :to="{ name: 'trip-create' }" variant="accent">免費開始規劃</BaseButton>
    </section>

    <footer class="landing-footer">
      <RouterLink class="landing-footer__brand" :to="{ name: 'landing' }">
        <span class="brand-mark"><AppIcon name="compass" :size="16" /></span>
        <strong>TripFlow AI</strong>
      </RouterLink>
      <nav aria-label="頁尾導覽">
        <a href="#privacy">隱私權</a>
        <a href="#terms">服務條款</a>
        <a href="#contact">聯絡我們</a>
      </nav>
      <small>© {{ currentYear }} TripFlow AI. 保留所有權利。</small>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import CategoryChip from '../components/trips/CategoryChip.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import type { IconName } from '../components/ui/icons'
import StatusBadge from '../components/ui/StatusBadge.vue'
import { DAY_COLORS } from '../data/generateTrip'
import type { PlaceCategory } from '../types'

const currentYear = new Date().getFullYear()

type PreviewPlace = {
  name: string
  category: PlaceCategory
  time: string
  duration: string
  gradient: string
}

// Decorative only, but built off the real card anatomy: a numbered thumbnail
// badge (fixed teal, same as .place-card__index — not per-day), a
// CategoryChip (real component, real per-category colors) + time, name,
// duration. Names/categories/durations are the same real Tokyo places seeded
// in mockPlaces.ts, not invented ones. Times cascade off each place's own
// duration only (no travel-time row anymore, so no travel gap folded in) —
// e.g. 08:00 + 2hr = 10:00 for the next card.
const previewColumns: { title: string; places: PreviewPlace[] }[] = [
  {
    title: '第1天',
    places: [
      { name: '淺草寺', category: 'culture', time: '08:00', duration: '2 小時', gradient: 'linear-gradient(135deg, #18233c, #c23b5c 50%, #f1a15f)' },
      { name: '築地場外市場', category: 'food', time: '10:00', duration: '2 小時', gradient: 'linear-gradient(135deg, #22465c, #d96b4b 45%, #f3d0bb)' },
      { name: '上野公園', category: 'nature', time: '12:00', duration: '2 小時', gradient: 'linear-gradient(135deg, #9fbf8f, #d9ecc8 55%, #f2f7e6)' },
    ],
  },
  {
    title: '第2天',
    places: [
      { name: '澀谷十字路口', category: 'activity', time: '08:00', duration: '1 小時', gradient: 'linear-gradient(135deg, #183c5d, #4a7de0 55%, #ff7a59)' },
      { name: '明治神宮', category: 'culture', time: '09:00', duration: '1.5 小時', gradient: 'linear-gradient(135deg, #22303c, #8161e6 60%, #cbbcf2)' },
      { name: '原宿街區', category: 'shopping', time: '10:30', duration: '2 小時', gradient: 'linear-gradient(135deg, #17384d, #e8618c 60%, #ffc3d4)' },
    ],
  },
  {
    title: '第3天',
    places: [
      { name: '秋葉原', category: 'shopping', time: '08:00', duration: '3 小時', gradient: 'linear-gradient(135deg, #2a4562, #00c5ab 45%, #f26157)' },
      { name: '台場海濱', category: 'activity', time: '11:00', duration: '2 小時', gradient: 'linear-gradient(135deg, #1e4b64, #0eb4cb 45%, #ee6554)' },
    ],
  },
]

const previewPins = [
  { label: '1', top: '24%', left: '38%', color: DAY_COLORS[0]! },
  { label: '2', top: '48%', left: '62%', color: DAY_COLORS[0]! },
  { label: '1', top: '68%', left: '44%', color: DAY_COLORS[1]! },
  { label: '2', top: '36%', left: '74%', color: DAY_COLORS[1]! },
  { label: '1', top: '77%', left: '58%', color: DAY_COLORS[2]! },
]

const mobilePreviewPlaces = computed(() => previewColumns[0]!.places)

const features: { icon: IconName; title: string; description: string }[] = [
  {
    icon: 'sparkle',
    title: 'AI 行程生成器',
    description: '用簡單的文字描述你的旅程，AI 就會建立完整的每日行程。',
  },
  {
    icon: 'grid',
    title: '看板式行程規劃',
    description: '用拖曳友善的欄位，整理每個地點、活動與待辦事項。',
  },
  {
    icon: 'pin',
    title: '互動地圖檢視',
    description: '在即時地圖上看到每個景點的位置，規劃時掌握空間關係。',
  },
  {
    icon: 'chat-sparkle',
    title: 'AI 行程助手',
    description: '規劃途中隨時打開「問問 AI」對話調整景點、時間或路線，不用整個重來。',
  },
]

const workflow = [
  {
    number: '01',
    title: '描述你的行程',
    description: '輸入目的地、日期、旅遊風格，以及任何偏好或想避開的地方。',
  },
  {
    number: '02',
    title: 'AI 生成你的計畫',
    description: 'TripFlow AI 建立完整的看板，並優化每日行程安排。',
  },
  {
    number: '03',
    title: '探索與調整',
    description: '檢視地圖、拖曳卡片重新排序，隨時依旅途狀況客製化景點。',
  },
  {
    number: '04',
    title: '確認交通與時間',
    description: '系統會自動算出地點之間的交通時間，時間衝突時也會即時提醒你。',
  },
]

const testimonials = [
  {
    quote: '我在 20 分鐘內就規劃好 10 天的日本行程，看板讓我一眼就能掌握所有安排。',
    name: '陳雅築',
    role: '獨自旅行者',
  },
  {
    quote: '地圖跟看板的組合太棒了，我可以看到路線、拖曳卡片來優化每一天的行程。',
    name: '林柏宇',
    role: '旅遊部落客',
  },
  {
    quote: '我們的聖托里尼蜜月旅行就是用這個規劃的，AI 建議非常精準，介面設計也很漂亮。',
    name: '王思穎',
    role: '情侶旅行者',
  },
  {
    quote: '帶小孩旅行常常臨時要改行程，我直接跟「問問 AI」說要調整，不用整個重排一次。',
    name: '張育誠',
    role: '親子旅行者',
  },
]
</script>
