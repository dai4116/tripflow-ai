<template>
  <div class="landing-page">
    <section class="landing-hero">
      <div class="landing-hero__copy">
        <StatusBadge>✦ AI 驅動・搶先體驗中</StatusBadge>
        <h1>用 AI 規劃行雲流水般的旅程。</h1>
        <p>
          描述你夢想中的旅程，TripFlow AI 會建立看板式行程、
          把每個景點標在地圖上，並隨著你的探索即時調整。
        </p>
        <div class="landing-hero__actions">
          <BaseButton :to="{ name: 'trip-create' }">✦ 規劃我的行程</BaseButton>
          <BaseButton :to="{ name: 'dashboard' }" variant="secondary">查看首頁 →</BaseButton>
        </div>
        <div class="landing-hero__trust">
          <span>◎ 免費開始使用</span>
          <span>◎ 免信用卡</span>
          <span>◎ AI 自動生成</span>
        </div>
      </div>

      <div class="product-preview" aria-label="TripFlow 產品預覽">
        <div class="product-preview__chrome">
          <span />
          <span />
          <span />
          <strong>app.tripflow.ai/board/tokyo-explorer</strong>
        </div>
        <div class="product-preview__board">
          <div v-for="column in previewColumns" :key="column" class="product-preview__column">
            <strong>{{ column }}</strong>
            <span class="product-preview__mini-card" />
            <span class="product-preview__mini-card" />
            <span class="product-preview__mini-card" />
          </div>
        </div>
        <div class="product-preview__map">
          <div class="product-preview__budget">$3,200 預算<br><span>已分配 65%</span></div>
          <span class="map-dot" style="top: 24%; left: 38%" />
          <span class="map-dot" style="top: 48%; left: 62%" />
          <span class="map-dot" style="top: 68%; left: 44%" />
          <span class="map-dot" style="top: 36%; left: 74%" />
          <span class="map-dot" style="top: 77%; left: 58%" />
        </div>
        <BaseCard class="product-preview__toast">
          <strong>行程已完成</strong>
          <span>18 個地點・7 天</span>
        </BaseCard>
      </div>

      <div class="landing-mobile-preview" aria-label="行程預覽卡片">
        <RouterLink
          v-for="trip in previewTrips"
          :key="trip.title"
          class="landing-mobile-trip"
          :to="{ name: 'trip-board', params: { tripId: trip.id } }"
        >
          <span class="landing-mobile-trip__image" :style="{ background: trip.imageGradient }" />
          <strong>{{ trip.title }}</strong>
          <small>⌖ {{ trip.destination }}</small>
        </RouterLink>
      </div>
    </section>

    <section id="features" class="landing-section" aria-label="功能特色">
      <div class="landing-section__header">
        <h2>聰明旅行所需的一切</h2>
        <p>從發想靈感到登機門，TripFlow AI 幫你搞定所有繁瑣細節。</p>
      </div>

      <div class="section-grid">
        <BaseCard v-for="feature in features" :key="feature.title">
          <StatusBadge tone="accent">{{ feature.label }}</StatusBadge>
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
          <span class="testimonial-card__stars">★★★★★</span>
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
      <small>© 2025 TripFlow AI. 保留所有權利。</small>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import { useTripsStore } from '../stores/trips'

const { trips } = storeToRefs(useTripsStore())
const previewColumns = ['規劃中', '第1天', '第2天']
const previewTrips = computed(() => trips.value.slice(0, 2))

const features = [
  {
    label: '✦',
    title: 'AI 行程生成器',
    description: '用簡單的文字描述你的旅程，AI 就會建立完整的每日行程。',
  },
  {
    label: '▦',
    title: '看板式行程規劃',
    description: '用拖曳友善的欄位，整理每個地點、活動與待辦事項。',
  },
  {
    label: '⌖',
    title: '互動地圖檢視',
    description: '在即時地圖上看到每個景點的位置，規劃時掌握空間關係。',
  },
]

const workflow = [
  {
    number: '01',
    title: '描述你的行程',
    description: '輸入目的地、日期、預算、旅遊風格，以及任何偏好或想避開的地方。',
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
]
</script>
