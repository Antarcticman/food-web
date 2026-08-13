import type { DishCategory, DishKind, DishVisualRecipe } from "../types";

const palettes = ["coral", "mint", "gold", "berry", "sky"] as const;

const categoryPatterns: Array<[DishCategory, RegExp]> = [
  ["drink", /飲|茶|咖啡|酒|汁|汽水|氣泡|可樂|拿鐵/i],
  ["soup", /湯|羹|鍋|濃湯|清湯/i],
  ["dessert", /甜|蛋糕|布丁|冰|塔|派|巧克力|可麗露|馬卡龍/i],
  ["dumpling", /餃|燒賣|包子|小籠包|餛飩/i],
  ["bread_pizza", /麵包|吐司|披薩|pizza|可頌|佛卡夏/i],
  ["noodle", /麵|烏龍|拉麵|義大利麵|米粉|冬粉/i],
  ["rice", /飯|燉飯|粥|丼|壽司/i],
  ["seafood", /魚|蝦|蟹|貝|干貝|鮭|鮪|章魚|花枝|牡蠣/i],
  ["meat", /牛|豬|雞|鴨|羊|肉|排|火腿/i],
  ["vegetable", /菜|沙拉|菇|筍|瓜|豆腐|花椰/i],
];

function hashName(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

export function inferDishCategory(name: string, kind: DishKind): DishCategory {
  const matched = categoryPatterns.find(([, pattern]) => pattern.test(name));
  if (matched) return matched[0];
  if (kind === "seafood" || kind === "meat" || kind === "dessert") return kind;
  return "other";
}

export function createDishVisualRecipe(name: string, kind: DishKind, preferredCategory?: DishCategory): DishVisualRecipe {
  const category = preferredCategory ?? inferDishCategory(name, kind);
  const seed = hashName(`${name}:${category}`);
  const vessel = category === "drink" ? "glass" : category === "soup" || category === "noodle" ? "bowl" : "plate";
  return {
    category,
    vessel,
    base: `${category}-base`,
    palette: palettes[seed % palettes.length],
    seed,
  };
}

export const categoryLabels: Record<DishCategory, string> = {
  vegetable: "蔬菜",
  rice: "飯類",
  noodle: "麵類",
  bread_pizza: "麵包／披薩",
  dumpling: "餃類",
  meat: "肉類",
  seafood: "海鮮",
  soup: "湯品",
  drink: "飲料",
  dessert: "甜點",
  other: "料理",
};
