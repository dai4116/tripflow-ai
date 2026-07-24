export const travelStyles = ['精準規劃', '自在慢旅', '深度探索', '熱血冒險']

// Shown to the user (button title + the live caption under the picker in
// CreateTripPage.vue) so a punchy 4-character label like "深度探索" doesn't
// leave them guessing what it actually changes about the itinerary. Same
// wording as api/_lib/tripGen.ts's STYLE_FLAVOR — that copy feeds the AI
// prompt, this one feeds the UI; kept in sync by hand since api/ and src/
// are independent deployable units (see that file's comment).
export const travelStyleHints: Record<string, string> = {
  精準規劃: '偏好效率高、評價好的必去景點，盡量減少繞路移動',
  自在慢旅: '景點數不用多，重視氛圍與步調，不趕行程',
  深度探索: '偏好小眾景點、巷弄與在地生活體驗，避免只選熱門觀光打卡點',
  熱血冒險: '偏好戶外、有挑戰性、新奇的活動與體驗',
}

export const preferences = [
  '必吃美食',
  '逛街購物',
  '熱門打卡',
  '人文古蹟',
  '藝術展覽',
  '特色建築',
  '戶外踏青',
  '自然秘境',
  '咖啡甜點',
  '樂園娛樂',
  '夜生活',
  '在地體驗',
  '室內景點',
  '親子友善',
]
