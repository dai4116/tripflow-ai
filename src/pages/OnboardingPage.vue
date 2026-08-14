<template>
  <section class="onboarding-page">
    <button type="button" class="onboarding-page__skip" @click="finish">略過</button>

    <Transition name="onboarding-slide" mode="out-in">
      <div :key="currentIndex" class="onboarding-slide">
        <div class="onboarding-slide__frame">
          <img
            v-for="(src, index) in currentStep.images"
            :key="src"
            :src="src"
            :alt="currentStep.title"
            class="onboarding-slide__image"
            :class="{ 'onboarding-slide__image--active': index === activeImageIndex }"
          />
        </div>

        <h2 class="onboarding-slide__title">{{ currentStep.title }}</h2>
        <p class="onboarding-slide__description">{{ currentStep.description }}</p>
      </div>
    </Transition>

    <div class="onboarding-page__footer">
      <div class="onboarding-page__dots" role="presentation">
        <span
          v-for="(step, index) in steps"
          :key="step.title"
          class="onboarding-page__dot"
          :class="{ 'onboarding-page__dot--active': index === currentIndex }"
        />
      </div>
      <BaseButton class="onboarding-page__next" @click="next">
        {{ isLastStep ? '開始使用' : '下一步' }}
      </BaseButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import step1 from '../assets/onboarding/step1.jpg'
import step2Board from '../assets/onboarding/step2_1.jpg'
import step2Map from '../assets/onboarding/step2_2.jpg'
import step3 from '../assets/onboarding/step3.jpg'
import BaseButton from '../components/ui/BaseButton.vue'
import { markOnboardingSeen } from '../data/onboarding'

const steps = [
  {
    title: '描述你的行程',
    description: '告訴 AI 你想去哪裡、玩幾天\n喜歡什麼樣的旅行風格，通通交給它',
    images: [step1],
  },
  {
    title: 'AI 生成完整行程',
    description: '景點、路線順序、停留時間都排好了\n看板、地圖兩種檢視方式隨你切換',
    images: [step2Board, step2Map],
  },
  {
    title: '隨時調整，問問 AI',
    description: '推薦景點、一鍵排序\n直接跟 AI 說一聲，馬上幫你更新行程',
    images: [step3],
  },
] as const

const route = useRoute()
const router = useRouter()
const currentIndex = ref(0)
const activeImageIndex = ref(0)

const currentStep = computed(() => steps[currentIndex.value])
const isLastStep = computed(() => currentIndex.value === steps.length - 1)

// Cross-fades step2's board/map screenshots on a timer while the user reads
// — a second, independent rotation nested inside the outer step1/2/3
// carousel (which only advances on the user's own "下一步" click). Only
// step2 has more than one image; every other step's watch callback below is
// a no-op past the interval clear.
let rotateTimer: number | undefined

function startImageRotation() {
  window.clearInterval(rotateTimer)
  activeImageIndex.value = 0
  const images = currentStep.value.images
  if (images.length <= 1) return
  rotateTimer = window.setInterval(() => {
    activeImageIndex.value = (activeImageIndex.value + 1) % images.length
  }, 2600)
}

watch(currentIndex, startImageRotation, { immediate: true })
onBeforeUnmount(() => window.clearInterval(rotateTimer))

// router/index.ts's beforeEach guard attaches the originally-requested URL
// as ?redirect= when it bounces a first-time visitor here (e.g. a direct
// link to a specific trip) — honor it so finishing/skipping onboarding
// sends them on to where they actually meant to go, not always the
// dashboard. Only accepts an internal path (starts with '/'), never a
// full/external URL, since this value came from the URL bar itself.
function finish() {
  markOnboardingSeen()
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    router.replace(redirect)
  } else {
    router.replace({ name: 'dashboard' })
  }
}

function next() {
  if (isLastStep.value) {
    finish()
    return
  }
  currentIndex.value += 1
}
</script>
