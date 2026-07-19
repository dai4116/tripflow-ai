const CJK_PATTERN = /[一-鿿]/

// A CJK parenthetical after a non-CJK brand is not necessarily a translation.
// These suffixes identify useful branch/campus qualifiers that must stay with
// the official name, e.g. "Wall Street English（信義分校）".
const PLACE_QUALIFIER_PATTERN =
  /(?:店|門市|分館|別館|分校|校區|園區|館別|航廈|教室|補習班|櫃位)$/

// Script alone cannot tell a translated name from an official foreign brand
// plus a Chinese annotation. Only collapse the ambiguous foreign（中文）form
// when both sides contain matching place-type words; the prompt remains the
// primary defence for transliterated names that cannot be identified safely.
const CLEAR_TRANSLATION_TYPE_PAIRS: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [/\bmarket\b/i, /(?:市場|市集|夜市)$/],
  [/\b(?:museum|gallery)\b/i, /(?:博物館|美術館|藝術館)$/],
  [/\bpark\b/i, /(?:公園|國家公園)$/],
  [/\b(?:station|terminal)\b/i, /(?:車站|總站)$/],
  [/\bairport\b/i, /機場$/],
  [/\b(?:temple|shrine)\b/i, /(?:寺|廟|神社)$/],
  [/\b(?:palace|castle)\b/i, /(?:宮|皇宮|城堡)$/],
  [/\b(?:zoo|aquarium)\b/i, /(?:動物園|水族館)$/],
]

function isClearTranslationPair(outer: string, inner: string): boolean {
  return CLEAR_TRANSLATION_TYPE_PAIRS.some(
    ([foreignType, chineseType]) => foreignType.test(outer) && chineseType.test(inner),
  )
}

// Shared by generate-trip.ts and ask-ai.ts's suggest_places tool — both ask
// Claude for Traditional-Chinese-only place names, but it occasionally still
// hands back a bilingual "English Name（中文名稱）" pair anyway. A Chinese-name
// first pair can safely prefer that Chinese name; a foreign-name first pair
// is only collapsed when the matching type words above make it unambiguous.
export function stripBilingualName(name: string): string {
  const trimmedName = name.trim()
  const match = trimmedName.match(/^(.*?)[(（]\s*([^()（）]+?)\s*[)）]\s*$/)
  if (!match) return trimmedName

  const outer = match[1]!.trim()
  const inner = match[2]!.trim()
  if (CJK_PATTERN.test(inner) && !CJK_PATTERN.test(outer)) {
    if (PLACE_QUALIFIER_PATTERN.test(inner)) return trimmedName
    return isClearTranslationPair(outer, inner) ? inner : trimmedName
  }
  if (CJK_PATTERN.test(outer) && !CJK_PATTERN.test(inner)) return outer.trim()
  return trimmedName
}
