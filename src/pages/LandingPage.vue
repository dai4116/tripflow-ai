<template>
  <div class="landing-page">
    <section class="landing-hero">
      <div class="landing-hero__copy">
        <StatusBadge><AppIcon name="sparkle" :size="12" /> AI 驅動・搶先體驗中</StatusBadge>
        <h1>用 AI 規劃行雲流水般的旅程</h1>
        <p>
          描述你夢想中的旅程，AI 幾分鐘內就生成完整規劃，
          行程有變動，一句話就能調整
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

    <section id="how-it-works" class="landing-section landing-section--white" aria-label="使用流程">
      <div class="landing-section__header">
        <h2>三步驟，讓 AI 幫你搞定行程</h2>
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

    <section class="landing-cta">
      <h2>準備好迎接下一場旅程了嗎？</h2>
      <p>讓 AI 幫你把時間花在旅行上，不是排行程上</p>
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
      <small>© {{ currentYear }} TripFlow AI. 保留所有權利</small>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import CategoryChip from '../components/trips/CategoryChip.vue'
import AppIcon from '../components/ui/AppIcon.vue'
import BaseButton from '../components/ui/BaseButton.vue'
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
      { name: '淺草寺', category: 'attraction', time: '08:00', duration: '2 小時', gradient: 'linear-gradient(135deg, #18233c, #c23b5c 50%, #f1a15f)' },
      { name: '築地場外市場', category: 'food', time: '10:00', duration: '2 小時', gradient: 'linear-gradient(135deg, #22465c, #d96b4b 45%, #f3d0bb)' },
      { name: '上野公園', category: 'attraction', time: '12:00', duration: '2 小時', gradient: 'linear-gradient(135deg, #9fbf8f, #d9ecc8 55%, #f2f7e6)' },
    ],
  },
  {
    title: '第2天',
    places: [
      { name: '澀谷十字路口', category: 'attraction', time: '08:00', duration: '1 小時', gradient: 'linear-gradient(135deg, #183c5d, #4a7de0 55%, #ff7a59)' },
      { name: '明治神宮', category: 'attraction', time: '09:00', duration: '1.5 小時', gradient: 'linear-gradient(135deg, #22303c, #8161e6 60%, #cbbcf2)' },
      { name: '原宿街區', category: 'shopping', time: '10:30', duration: '2 小時', gradient: 'linear-gradient(135deg, #17384d, #e8618c 60%, #ffc3d4)' },
    ],
  },
  {
    title: '第3天',
    places: [
      { name: '秋葉原', category: 'shopping', time: '08:00', duration: '3 小時', gradient: 'linear-gradient(135deg, #2a4562, #00c5ab 45%, #f26157)' },
      { name: '台場海濱', category: 'attraction', time: '11:00', duration: '2 小時', gradient: 'linear-gradient(135deg, #1e4b64, #0eb4cb 45%, #ee6554)' },
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

const workflow = [
  {
    number: '01',
    title: '描述你的行程',
    description: '輸入目的地、天數、旅遊風格，或想避開的地方——不用填落落長的表單',
  },
  {
    number: '02',
    title: 'AI 生成完整計畫',
    description: '幾分鐘內排好每天的景點順序、標上地圖位置，交通時間也自動算好，時間衝突時主動提醒',
  },
  {
    number: '03',
    title: '隨時調整，怎麼順手怎麼來',
    description: '規劃途中可拖曳卡片重新排序，或打開「問問 AI」對話，請它換景點、搬時段——不用整個重排',
  },
]
</script>
