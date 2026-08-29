<template>
  <section class="admin-usage-page">
    <div class="admin-usage-page__inner">
      <h1>後台使用量</h1>

      <form v-if="!secret" class="admin-usage-page__gate" @submit.prevent="submitSecret">
        <label for="admin-secret">輸入管理密鑰</label>
        <input id="admin-secret" v-model="secretInput" type="password" autocomplete="off" placeholder="密鑰" />
        <button type="submit">進入</button>
        <p v-if="gateError" class="admin-usage-page__error">{{ gateError }}</p>
      </form>

      <template v-else>
        <div class="admin-usage-page__toolbar">
          <button type="button" @click="refresh">重新整理</button>
          <button type="button" @click="logout">清除密鑰</button>
        </div>

        <p v-if="loadError" class="admin-usage-page__error">{{ loadError }}</p>

        <div v-else-if="!result" class="admin-usage-page__loading">載入中…</div>

        <div v-else class="admin-usage-page__series">
          <div v-for="series in result.series" :key="series.endpoint" class="admin-usage-page__card">
            <div class="admin-usage-page__card-head">
              <h2>{{ series.label }}</h2>
              <span class="admin-usage-page__today">
                今天 {{ todayCount(series) }} / {{ series.globalPerDay }}
              </span>
            </div>

            <div class="admin-usage-page__chart">
              <div
                v-for="day in series.history"
                :key="day.date"
                class="admin-usage-page__bar"
                :title="`${day.date}：${day.count} 次`"
              >
                <div class="admin-usage-page__bar-fill" :style="{ height: barHeight(day.count, series.globalPerDay) }"></div>
              </div>
            </div>
            <div class="admin-usage-page__chart-labels">
              <span>{{ series.history[0]?.date }}</span>
              <span>{{ series.history[series.history.length - 1]?.date }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { clearStoredAdminSecret, fetchUsage, getStoredAdminSecret, storeAdminSecret, type UsageResult, type UsageSeries } from '../data/adminUsageClient'

const secret = ref<string | undefined>(undefined)
const secretInput = ref('')
const gateError = ref<string | undefined>(undefined)
const loadError = ref<string | undefined>(undefined)
const result = ref<UsageResult | undefined>(undefined)

function todayCount(series: UsageSeries): number {
  return series.history[series.history.length - 1]?.count ?? 0
}

function barHeight(count: number, globalPerDay: number): string {
  if (globalPerDay <= 0) return '0%'
  return `${Math.min(100, Math.round((count / globalPerDay) * 100))}%`
}

async function load() {
  if (!secret.value) return
  loadError.value = undefined
  const response = await fetchUsage(secret.value)
  if ('error' in response) {
    if (response.error === 'unauthorized') {
      // Stored secret no longer valid — drop it and fall back to the gate
      // instead of endlessly showing a load error the user can't act on.
      clearStoredAdminSecret()
      secret.value = undefined
      gateError.value = '密鑰不正確，請重新輸入'
      return
    }
    loadError.value = response.error === 'unconfigured' ? '後台尚未設定 ADMIN_DASHBOARD_SECRET' : '載入失敗，請稍後再試'
    return
  }
  result.value = response
}

function submitSecret() {
  gateError.value = undefined
  const value = secretInput.value.trim()
  if (!value) return
  storeAdminSecret(value)
  secret.value = value
  secretInput.value = ''
  load()
}

function refresh() {
  result.value = undefined
  load()
}

function logout() {
  clearStoredAdminSecret()
  secret.value = undefined
  result.value = undefined
}

onMounted(() => {
  const stored = getStoredAdminSecret()
  if (stored) {
    secret.value = stored
    load()
  }
})
</script>
