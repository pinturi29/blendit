// Best-effort keyword match from a place's free-text category to a single
// representative emoji -- shared by the map pins and the Itinerary tab's
// place rows so both use the exact same icon for the exact same place.
// Order matters: first matching row wins, so more specific keywords
// (e.g. "taco") are listed before generic ones (e.g. "restaurant" isn't
// listed at all -- it just falls through to the plain-restaurant default).
const CATEGORY_EMOJI: Array<[string[], string]> = [
  [['taco', 'burrito', 'taqueria'], '🌮'],
  [['bakery', 'bake', 'pastry'], '🥐'],
  [['coffee', 'cafe', 'café', 'espresso'], '☕'],
  [['bagel'], '🥯'],
  [['pizza'], '🍕'],
  [['burger'], '🍔'],
  [['sushi'], '🍣'],
  [['ramen', 'noodle'], '🍜'],
  [['ice cream', 'gelato'], '🍦'],
  [['cheesecake', 'dessert', 'cake', 'candy'], '🍰'],
  [['donut', 'doughnut'], '🍩'],
  [['deli', 'sandwich'], '🥪'],
  [['bar', 'pub', 'lounge', 'cocktail', 'speakeasy'], '🍸'],
  [['seafood'], '🦞'],
  [['bbq', 'barbecue'], '🍖'],
  [['steak'], '🥩'],
  [['breakfast', 'brunch', 'pancake'], '🥞'],
  [['chicken'], '🍗'],
  [['wine'], '🍷'],
  [['brewery', 'beer'], '🍺'],
  [['market', 'grocery'], '🛒'],
  [['hotel'], '🏨'],
];

export function emojiForCategory(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  for (const [keywords, emoji] of CATEGORY_EMOJI) {
    if (keywords.some((k) => c.includes(k))) return emoji;
  }
  return '🍽️';
}
