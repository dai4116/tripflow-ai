import { PLACE_GRADIENTS } from './generateTrip'
import type { ExploreTemplate, Place } from '../types'

// Curated sample itineraries for the Explore page — independent of the
// user's own trips/places in the store. copyTemplateTrip() in the trips
// store clones these (with fresh ids) into the user's real trip list.
// Each template runs 4-5 days with 3 places/day, matching a realistic
// pace rather than a bare-minimum demo itinerary.
export const exploreTemplates: ExploreTemplate[] = [
  {
    id: 'kyoto-slow',
    title: '京都古都慢旅',
    destination: '京都，日本',
    tagline: '穿梭百年古寺與竹林小徑，感受京都的四季風雅。',
    days: 5,
    travelers: 2,
    placeCount: 15,
    color: '#a8577a',
    imageGradient: 'linear-gradient(135deg, #2b2140, #a8577a 50%, #f0d9c6)',
    preferences: ['廟宇', '建築', '街頭小吃'],
    pace: 'relaxed',
    columns: [
      { id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['kyoto-kiyomizudera', 'kyoto-ninenzaka', 'kyoto-gion'] },
      { id: 'day-2', title: '第2天', dayNumber: 2, placeIds: ['kyoto-fushimi-inari', 'kyoto-nishiki-market', 'kyoto-ramen-koji'] },
      { id: 'day-3', title: '第3天', dayNumber: 3, placeIds: ['kyoto-arashiyama', 'kyoto-togetsukyo', 'kyoto-sagano-train'] },
      { id: 'day-4', title: '第4天', dayNumber: 4, placeIds: ['kyoto-kinkakuji', 'kyoto-ryoanji', 'kyoto-gyoen'] },
      { id: 'day-5', title: '第5天', dayNumber: 5, placeIds: ['kyoto-kifune-shrine', 'kyoto-kurama-dera', 'kyoto-station-shopping'] },
    ],
  },
  {
    id: 'bangkok-food',
    title: '曼谷美食探索',
    destination: '曼谷，泰國',
    tagline: '從路邊攤到河岸夜市，一次吃遍曼谷的道地滋味。',
    days: 4,
    travelers: 2,
    placeCount: 12,
    color: '#e0703a',
    imageGradient: 'linear-gradient(135deg, #3a1f1f, #e0703a 50%, #f7dfb0)',
    preferences: ['在地美食', '街頭小吃', '夜生活'],
    pace: 'packed',
    columns: [
      { id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['bkk-chatuchak', 'bkk-khaosan', 'bkk-siam-paragon'] },
      { id: 'day-2', title: '第2天', dayNumber: 2, placeIds: ['bkk-grand-palace', 'bkk-wat-pho', 'bkk-river-cruise'] },
      { id: 'day-3', title: '第3天', dayNumber: 3, placeIds: ['bkk-chinatown', 'bkk-ratchada-market', 'bkk-sky-bar'] },
      { id: 'day-4', title: '第4天', dayNumber: 4, placeIds: ['bkk-damnoen-market', 'bkk-thai-massage', 'bkk-airport-shopping'] },
    ],
  },
  {
    id: 'chiangmai-retreat',
    title: '清邁療癒假期',
    destination: '清邁，泰國',
    tagline: '在山城的悠閒步調裡，享受咖啡香與寺廟鐘聲。',
    days: 5,
    travelers: 2,
    placeCount: 15,
    color: '#4d9166',
    imageGradient: 'linear-gradient(135deg, #1e3a2e, #4d9166 50%, #eaf0c8)',
    preferences: ['自然', '咖啡廳', '廟宇'],
    pace: 'relaxed',
    columns: [
      { id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['cnx-wat-phra-singh', 'cnx-wat-chedi-luang', 'cnx-tha-phae-gate'] },
      { id: 'day-2', title: '第2天', dayNumber: 2, placeIds: ['cnx-nimman-cafe', 'cnx-art-museum', 'cnx-one-nimman'] },
      { id: 'day-3', title: '第3天', dayNumber: 3, placeIds: ['cnx-doi-suthep', 'cnx-bhubing-palace', 'cnx-hmong-village'] },
      { id: 'day-4', title: '第4天', dayNumber: 4, placeIds: ['cnx-elephant-sanctuary', 'cnx-zipline', 'cnx-riverside-cafe'] },
      { id: 'day-5', title: '第5天', dayNumber: 5, placeIds: ['cnx-sunday-market', 'cnx-old-city-walk', 'cnx-riverside-dinner'] },
    ],
  },
  {
    id: 'seoul-shopping',
    title: '首爾購物美妝之旅',
    destination: '首爾，韓國',
    tagline: '從明洞美妝店逛到弘大夜生活，首爾潮流一次入手。',
    days: 4,
    travelers: 2,
    placeCount: 12,
    color: '#6f6fd6',
    imageGradient: 'linear-gradient(135deg, #241f3d, #6f6fd6 50%, #e9e3fb)',
    preferences: ['購物', '在地美食', '夜生活'],
    pace: 'balanced',
    columns: [
      { id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['seoul-myeongdong', 'seoul-namsan-tower', 'seoul-myeongdong-food'] },
      { id: 'day-2', title: '第2天', dayNumber: 2, placeIds: ['seoul-gyeongbokgung', 'seoul-bukchon', 'seoul-hongdae'] },
      { id: 'day-3', title: '第3天', dayNumber: 3, placeIds: ['seoul-ddp', 'seoul-gwangjang-market', 'seoul-itaewon'] },
      { id: 'day-4', title: '第4天', dayNumber: 4, placeIds: ['seoul-lotte-tower', 'seoul-coex', 'seoul-airport-duty-free'] },
    ],
  },
]

function gradientFor(index: number): string {
  return PLACE_GRADIENTS[index % PLACE_GRADIENTS.length]
}

export const explorePlaces: Place[] = [
  // 京都古都慢旅
  { id: 'kyoto-kiyomizudera', tripId: 'kyoto-slow', name: '清水寺', category: 'culture', estimatedTime: 2, address: '京都・東山區', lat: 34.9949, lng: 135.7850, description: '木造舞台懸空而建，可以俯瞰整個京都市區的景色。', columnId: 'day-1', imageGradient: gradientFor(0) },
  { id: 'kyoto-ninenzaka', tripId: 'kyoto-slow', name: '二寧坂・三寧坂', category: 'shopping', estimatedTime: 1.5, address: '京都・東山區', lat: 34.9959, lng: 135.7808, description: '石板坡道兩旁是傳統町屋改建的甜點與雜貨小店。', columnId: 'day-1', imageGradient: gradientFor(1) },
  { id: 'kyoto-gion', tripId: 'kyoto-slow', name: '祇園花見小路', category: 'culture', estimatedTime: 1.5, address: '京都・祇園', lat: 35.0037, lng: 135.7752, description: '傳統町屋林立的石板路，運氣好還能巧遇藝妓。', columnId: 'day-1', imageGradient: gradientFor(2) },
  { id: 'kyoto-fushimi-inari', tripId: 'kyoto-slow', name: '伏見稻荷大社', category: 'culture', estimatedTime: 2, address: '京都・伏見區', lat: 34.9671, lng: 135.7727, description: '千本鳥居沿山而建，是京都最具代表性的神社景觀。', travelTip: '建議清晨前往，人潮較少也比較涼爽', columnId: 'day-2', imageGradient: gradientFor(3) },
  { id: 'kyoto-nishiki-market', tripId: 'kyoto-slow', name: '錦市場', category: 'food', estimatedTime: 1.5, address: '京都・中京區', lat: 35.0050, lng: 135.7649, description: '「京都的廚房」，可以邊走邊吃各種在地小吃與醃漬物。', columnId: 'day-2', imageGradient: gradientFor(4) },
  { id: 'kyoto-ramen-koji', tripId: 'kyoto-slow', name: '京都拉麵小路', category: 'food', estimatedTime: 1, address: '京都・京都車站', lat: 34.9858, lng: 135.7588, description: '京都車站樓上集結多家日本拉麵名店，一次比較各地風味。', columnId: 'day-2', imageGradient: gradientFor(5) },
  { id: 'kyoto-arashiyama', tripId: 'kyoto-slow', name: '嵐山竹林', category: 'nature', estimatedTime: 1.5, address: '京都・嵐山', lat: 35.0170, lng: 135.6717, description: '高聳竹林形成的自然隧道，光影穿透竹葉間的畫面很療癒。', columnId: 'day-3', imageGradient: gradientFor(0) },
  { id: 'kyoto-togetsukyo', tripId: 'kyoto-slow', name: '渡月橋', category: 'nature', estimatedTime: 1, address: '京都・嵐山', lat: 35.0094, lng: 135.6779, description: '橫跨桂川的地標橋樑，秋天紅葉倒映水面格外好看。', columnId: 'day-3', imageGradient: gradientFor(1) },
  { id: 'kyoto-sagano-train', tripId: 'kyoto-slow', name: '嵐山小火車', category: 'activity', estimatedTime: 1.5, address: '京都・嵯峨野', lat: 35.0192, lng: 135.6742, description: '沿保津峽緩緩而行的復古觀光小火車，沿途峽谷景色壯闊。', travelTip: '假日建議提前預約座位', columnId: 'day-3', imageGradient: gradientFor(2) },
  { id: 'kyoto-kinkakuji', tripId: 'kyoto-slow', name: '金閣寺', category: 'culture', estimatedTime: 1.5, address: '京都・北區', lat: 35.0394, lng: 135.7292, description: '金箔覆蓋的舍利殿倒映在鏡湖池中，京都最上鏡的景點之一。', columnId: 'day-4', imageGradient: gradientFor(3) },
  { id: 'kyoto-ryoanji', tripId: 'kyoto-slow', name: '龍安寺', category: 'culture', estimatedTime: 1, address: '京都・右京區', lat: 35.0345, lng: 135.7183, description: '以枯山水石庭聞名，很適合靜靜坐著沉澱心情。', columnId: 'day-4', imageGradient: gradientFor(4) },
  { id: 'kyoto-gyoen', tripId: 'kyoto-slow', name: '京都御苑', category: 'nature', estimatedTime: 1.5, address: '京都・上京區', lat: 35.0247, lng: 135.7625, description: '市中心的大片綠地，前京都御所所在地，散步起來很舒服。', columnId: 'day-4', imageGradient: gradientFor(5) },
  { id: 'kyoto-kifune-shrine', tripId: 'kyoto-slow', name: '貴船神社', category: 'nature', estimatedTime: 1.5, address: '京都・左京區', lat: 35.1216, lng: 135.7649, description: '沿溪而建的朱紅燈籠參道，是京都近郊避暑的私房景點。', columnId: 'day-5', imageGradient: gradientFor(0) },
  { id: 'kyoto-kurama-dera', tripId: 'kyoto-slow', name: '鞍馬寺', category: 'culture', estimatedTime: 2, address: '京都・鞍馬', lat: 35.1177, lng: 135.7714, description: '藏身山林間的古寺，纜車加健行步道能俯瞰整片山谷。', columnId: 'day-5', imageGradient: gradientFor(1) },
  { id: 'kyoto-station-shopping', tripId: 'kyoto-slow', name: '京都車站伊勢丹購物', category: 'shopping', estimatedTime: 1.5, address: '京都・京都車站', lat: 34.9858, lng: 135.7588, description: '離站搭車前的最後採買，伴手禮、甜點與百貨一次逛齊。', columnId: 'day-5', imageGradient: gradientFor(2) },

  // 曼谷美食探索
  { id: 'bkk-chatuchak', tripId: 'bangkok-food', name: '恰圖恰週末市集', category: 'shopping', estimatedTime: 3, address: '曼谷・扎都甲', lat: 13.7999, lng: 100.5502, description: '東南亞最大的週末市集之一，服飾、雜貨、小吃應有盡有。', travelTip: '面積很大，建議先鎖定幾區再逛以免迷路', columnId: 'day-1', imageGradient: gradientFor(3) },
  { id: 'bkk-khaosan', tripId: 'bangkok-food', name: '考山路', category: 'activity', estimatedTime: 2, address: '曼谷・考山', lat: 13.7590, lng: 100.4977, description: '背包客聖地，路邊攤、酒吧與街頭表演讓夜晚熱鬧不停。', columnId: 'day-1', imageGradient: gradientFor(4) },
  { id: 'bkk-siam-paragon', tripId: 'bangkok-food', name: '暹羅百麗宮購物中心', category: 'shopping', estimatedTime: 2, address: '曼谷・暹羅', lat: 13.7460, lng: 100.5340, description: '曼谷最頂級的百貨商場之一，也有超人氣美食街。', columnId: 'day-1', imageGradient: gradientFor(5) },
  { id: 'bkk-grand-palace', tripId: 'bangkok-food', name: '大皇宮', category: 'culture', estimatedTime: 2.5, address: '曼谷・帕那空區', lat: 13.7500, lng: 100.4913, description: '金碧輝煌的皇室建築群，玉佛寺是必訪亮點。', columnId: 'day-2', imageGradient: gradientFor(0) },
  { id: 'bkk-wat-pho', tripId: 'bangkok-food', name: '臥佛寺', category: 'culture', estimatedTime: 1.5, address: '曼谷・帕那空區', lat: 13.7465, lng: 100.4930, description: '巨型金色臥佛像所在地，也是泰式按摩的發源地。', columnId: 'day-2', imageGradient: gradientFor(1) },
  { id: 'bkk-river-cruise', tripId: 'bangkok-food', name: '湄南河夜遊晚餐船', category: 'food', estimatedTime: 2, address: '曼谷・昭披耶河', lat: 13.7295, lng: 100.5044, description: '邊享用泰式料理邊欣賞沿岸點燈的寺廟與大橋夜景。', columnId: 'day-2', imageGradient: gradientFor(2) },
  { id: 'bkk-chinatown', tripId: 'bangkok-food', name: '中國城耀華力路', category: 'food', estimatedTime: 2, address: '曼谷・三聘', lat: 13.7405, lng: 100.5075, description: '整條路都是海鮮熱炒與燕窩甜品，晚上比白天更熱鬧。', columnId: 'day-3', imageGradient: gradientFor(3) },
  { id: 'bkk-ratchada-market', tripId: 'bangkok-food', name: '拉差達火車夜市', category: 'food', estimatedTime: 2, address: '曼谷・拉差達皮色', lat: 13.7661, lng: 100.5683, description: '五彩霓虹燈下的在地夜市，適合邊逛邊吃邊拍照。', columnId: 'day-3', imageGradient: gradientFor(4) },
  { id: 'bkk-sky-bar', tripId: 'bangkok-food', name: '天空酒吧', category: 'activity', estimatedTime: 1.5, address: '曼谷・沙吞', lat: 13.7203, lng: 100.5155, description: '居高臨下欣賞曼谷天際線，是行程收尾的浪漫選擇。', columnId: 'day-3', imageGradient: gradientFor(5) },
  { id: 'bkk-damnoen-market', tripId: 'bangkok-food', name: '丹嫩莎朵水上市場', category: 'activity', estimatedTime: 3, address: '曼谷近郊・叻丕府', lat: 13.5171, lng: 99.9615, description: '搭長尾船穿梭水道，向船上小販買現做的水果與小吃。', travelTip: '建議清晨出發，太陽升起後會非常炎熱', columnId: 'day-4', imageGradient: gradientFor(0) },
  { id: 'bkk-thai-massage', tripId: 'bangkok-food', name: '傳統泰式按摩體驗', category: 'activity', estimatedTime: 1.5, address: '曼谷・帕那空區', lat: 13.7440, lng: 100.4930, description: '在按摩發源地體驗道地泰式古法按摩，舒緩連日走跳的疲勞。', columnId: 'day-4', imageGradient: gradientFor(1) },
  { id: 'bkk-airport-shopping', tripId: 'bangkok-food', name: '曼谷機場免稅購物', category: 'shopping', estimatedTime: 1.5, address: '曼谷・素萬那普機場', lat: 13.6900, lng: 100.7501, description: '離境前最後採買零食伴手禮與免稅美妝的好地方。', columnId: 'day-4', imageGradient: gradientFor(2) },

  // 清邁療癒假期
  { id: 'cnx-wat-phra-singh', tripId: 'chiangmai-retreat', name: '帕辛寺', category: 'culture', estimatedTime: 1.5, address: '清邁・古城區', lat: 18.7889, lng: 98.9820, description: '清邁最受尊崇的寺廟之一，蘭納風格建築非常精緻。', columnId: 'day-1', imageGradient: gradientFor(3) },
  { id: 'cnx-wat-chedi-luang', tripId: 'chiangmai-retreat', name: '契迪龍寺', category: 'culture', estimatedTime: 1, address: '清邁・古城區', lat: 18.7877, lng: 98.9862, description: '高聳的古城地標佛塔，殘缺的塔身反而更有歲月感。', columnId: 'day-1', imageGradient: gradientFor(4) },
  { id: 'cnx-tha-phae-gate', tripId: 'chiangmai-retreat', name: '塔佩門', category: 'activity', estimatedTime: 1, address: '清邁・古城區', lat: 18.7877, lng: 98.9931, description: '古城牆的主要城門，傍晚常有街頭表演與鴿子群聚。', columnId: 'day-1', imageGradient: gradientFor(5) },
  { id: 'cnx-nimman-cafe', tripId: 'chiangmai-retreat', name: '寧曼路咖啡廳', category: 'cafe', estimatedTime: 1.5, address: '清邁・寧曼路', lat: 18.8018, lng: 98.9668, description: '文青咖啡廳一間接一間，很適合悠閒消磨一個下午。', columnId: 'day-2', imageGradient: gradientFor(0) },
  { id: 'cnx-art-museum', tripId: 'chiangmai-retreat', name: '清邁大學藝術博物館', category: 'museum', estimatedTime: 1.5, address: '清邁・清邁大學', lat: 18.8020, lng: 98.9530, description: '靜謐的校園藝術空間，適合安排在行程的緩衝時段。', columnId: 'day-2', imageGradient: gradientFor(1) },
  { id: 'cnx-one-nimman', tripId: 'chiangmai-retreat', name: '寧曼路文創園區', category: 'shopping', estimatedTime: 1.5, address: '清邁・寧曼路', lat: 18.8028, lng: 98.9677, description: '網美建築聚集的文創商圈，晚上有小型市集與live music。', columnId: 'day-2', imageGradient: gradientFor(2) },
  { id: 'cnx-doi-suthep', tripId: 'chiangmai-retreat', name: '素帖寺', category: 'nature', estimatedTime: 2.5, address: '清邁・素帖山', lat: 18.8047, lng: 98.9217, description: '位於山頂的金色佛塔，可以俯瞰整個清邁市區。', travelTip: '山路較彎，容易暈車的話建議備暈車藥', columnId: 'day-3', imageGradient: gradientFor(3) },
  { id: 'cnx-bhubing-palace', tripId: 'chiangmai-retreat', name: '蒲屏皇家花園', category: 'nature', estimatedTime: 1.5, address: '清邁・素帖山', lat: 18.8494, lng: 98.8977, description: '皇室冬宮花園，四季花卉修剪得很整齊，涼爽宜人。', columnId: 'day-3', imageGradient: gradientFor(4) },
  { id: 'cnx-hmong-village', tripId: 'chiangmai-retreat', name: '苗族山村', category: 'culture', estimatedTime: 1.5, address: '清邁・蒲屏山區', lat: 18.8360, lng: 98.8935, description: '山區少數民族聚落，可以近距離認識苗族的傳統工藝與生活。', columnId: 'day-3', imageGradient: gradientFor(5) },
  { id: 'cnx-elephant-sanctuary', tripId: 'chiangmai-retreat', name: '湄埃大象保護區', category: 'nature', estimatedTime: 4, address: '清邁・湄埃', lat: 18.9339, lng: 98.8253, description: '以友善方式近距離觀察並餵食大象，不騎乘不表演。', columnId: 'day-4', imageGradient: gradientFor(0) },
  { id: 'cnx-zipline', tripId: 'chiangmai-retreat', name: '湄沙叢林飛索', category: 'activity', estimatedTime: 3, address: '清邁・湄沙', lat: 18.9932, lng: 98.9391, description: '穿梭雨林樹冠層的飛索體驗，很適合喜歡刺激的旅伴。', columnId: 'day-4', imageGradient: gradientFor(1) },
  { id: 'cnx-riverside-cafe', tripId: 'chiangmai-retreat', name: '河畔咖啡廳', category: 'cafe', estimatedTime: 1.5, address: '清邁・平河畔', lat: 18.7910, lng: 99.0020, description: '坐擁平河景觀的悠閒咖啡廳，適合結束戶外行程後放鬆。', columnId: 'day-4', imageGradient: gradientFor(2) },
  { id: 'cnx-sunday-market', tripId: 'chiangmai-retreat', name: '週日夜市', category: 'shopping', estimatedTime: 2, address: '清邁・古城區', lat: 18.7877, lng: 98.9873, description: '整條古城主街封街變成市集，手工藝品與小吃雲集。', columnId: 'day-5', imageGradient: gradientFor(3) },
  { id: 'cnx-old-city-walk', tripId: 'chiangmai-retreat', name: '古城城牆漫步', category: 'activity', estimatedTime: 1.5, address: '清邁・古城區', lat: 18.7883, lng: 98.9853, description: '沿著護城河與城牆遺跡散步，感受清邁悠閒的步調。', columnId: 'day-5', imageGradient: gradientFor(4) },
  { id: 'cnx-riverside-dinner', tripId: 'chiangmai-retreat', name: '河畔晚餐', category: 'food', estimatedTime: 2, address: '清邁・平河畔', lat: 18.7910, lng: 99.0020, description: '坐在平河畔享用道地北泰料理，為旅程畫下悠閒句點。', columnId: 'day-5', imageGradient: gradientFor(5) },

  // 首爾購物美妝之旅
  { id: 'seoul-myeongdong', tripId: 'seoul-shopping', name: '明洞購物街', category: 'shopping', estimatedTime: 3, address: '首爾・明洞', lat: 37.5636, lng: 126.9850, description: '美妝店與流行服飾店林立，也有滿街的路邊小吃。', columnId: 'day-1', imageGradient: gradientFor(0) },
  { id: 'seoul-namsan-tower', tripId: 'seoul-shopping', name: '南山首爾塔', category: 'activity', estimatedTime: 2, address: '首爾・龍山區', lat: 37.5512, lng: 126.9882, description: '搭纜車登頂俯瞰首爾夜景，也是熱門的告白鎖景點。', columnId: 'day-1', imageGradient: gradientFor(1) },
  { id: 'seoul-myeongdong-food', tripId: 'seoul-shopping', name: '明洞餃子街', category: 'food', estimatedTime: 1, address: '首爾・明洞', lat: 37.5633, lng: 126.9860, description: '幾十年老字號刀切麵與餃子店聚集，宵夜消夜的好選擇。', columnId: 'day-1', imageGradient: gradientFor(2) },
  { id: 'seoul-gyeongbokgung', tripId: 'seoul-shopping', name: '景福宮', category: 'culture', estimatedTime: 2, address: '首爾・鐘路區', lat: 37.5796, lng: 126.9770, description: '朝鮮王朝的正宮，穿韓服入場還能免費參觀。', columnId: 'day-2', imageGradient: gradientFor(3) },
  { id: 'seoul-bukchon', tripId: 'seoul-shopping', name: '北村韓屋村', category: 'culture', estimatedTime: 1.5, address: '首爾・鐘路區', lat: 37.5814, lng: 126.9850, description: '保存完整的傳統韓屋巷弄，很多人會租韓服來這裡拍照。', columnId: 'day-2', imageGradient: gradientFor(4) },
  { id: 'seoul-hongdae', tripId: 'seoul-shopping', name: '弘大商圈', category: 'activity', estimatedTime: 3, address: '首爾・弘益大學周邊', lat: 37.5563, lng: 126.9236, description: '年輕活力的大學商圈，街頭表演與夜店文化很熱鬧。', columnId: 'day-2', imageGradient: gradientFor(5) },
  { id: 'seoul-ddp', tripId: 'seoul-shopping', name: '東大門設計廣場', category: 'shopping', estimatedTime: 2, address: '首爾・東大門', lat: 37.5665, lng: 127.0092, description: '流線型未來感建築，周邊也是批發時尚的購物天堂。', columnId: 'day-3', imageGradient: gradientFor(0) },
  { id: 'seoul-gwangjang-market', tripId: 'seoul-shopping', name: '廣藏市場', category: 'food', estimatedTime: 1.5, address: '首爾・鐘路區', lat: 37.5701, lng: 126.9995, description: '首爾最古老的傳統市場，生拌牛肉與綠豆煎餅是招牌。', columnId: 'day-3', imageGradient: gradientFor(1) },
  { id: 'seoul-itaewon', tripId: 'seoul-shopping', name: '梨泰院夜店街', category: 'activity', estimatedTime: 2.5, address: '首爾・龍山區', lat: 37.5347, lng: 126.9946, description: '異國風情濃厚的夜生活區，酒吧與各國料理餐廳林立。', columnId: 'day-3', imageGradient: gradientFor(2) },
  { id: 'seoul-lotte-tower', tripId: 'seoul-shopping', name: '樂天世界塔', category: 'activity', estimatedTime: 2, address: '首爾・松坡區', lat: 37.5125, lng: 127.1025, description: '韓國最高建築，觀景台可以360度俯瞰首爾全景。', columnId: 'day-4', imageGradient: gradientFor(3) },
  { id: 'seoul-coex', tripId: 'seoul-shopping', name: '江南COEX商場', category: 'shopping', estimatedTime: 2, address: '首爾・江南區', lat: 37.5115, lng: 127.0590, description: '巨型地下購物城，星空圖書館也是熱門拍照打卡點。', columnId: 'day-4', imageGradient: gradientFor(4) },
  { id: 'seoul-airport-duty-free', tripId: 'seoul-shopping', name: '仁川機場免稅店', category: 'shopping', estimatedTime: 1.5, address: '首爾・仁川機場', lat: 37.4602, lng: 126.4407, description: '離境前最後補貨美妝與伴手禮，品牌選擇齊全。', columnId: 'day-4', imageGradient: gradientFor(5) },
]

export function explorePlacesForTemplate(templateId: string): Place[] {
  return explorePlaces.filter((place) => place.tripId === templateId)
}
