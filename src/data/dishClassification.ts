import type {
  Dish,
  DishCategory,
  DishCourseRole,
  DishIngredientFamily,
} from "../types";

export interface DishClassificationFilter {
  courseRoles?: DishCourseRole[];
  ingredientFamilies?: DishIngredientFamily[];
}

export const courseRoleLabels: Record<DishCourseRole, string> = {
  appetizer: "前菜",
  main: "主菜",
  staple: "主食",
  side: "配菜",
  soup: "湯",
  dessert: "甜點",
  drink: "飲料",
  snack: "點心",
  other: "其他",
};

export const ingredientFamilyLabels: Record<DishIngredientFamily, string> = {
  meat: "肉類",
  seafood: "海鮮",
  vegetable: "蔬菜",
  egg_dairy: "蛋奶",
  grain_noodle: "米麵穀物",
  fruit: "水果",
  legume: "豆類",
  mushroom: "菇類",
  mixed: "綜合",
  other: "其他",
};

export const allCourseRoles = Object.keys(courseRoleLabels) as DishCourseRole[];
export const allIngredientFamilies = Object.keys(ingredientFamilyLabels) as DishIngredientFamily[];

interface Rule<T extends string> {
  value: T;
  pattern: RegExp;
  weight: number;
}

const roleRules: Rule<DishCourseRole>[] = [
  { value: "dessert", pattern: /布丁|蛋糕|甜點|冰淇淋|雪酪|可麗露|馬卡龍|提拉米蘇|泡芙|奶酪|果凍|舒芙蕾|塔(?:\s|$)|派(?:\s|$)/i, weight: 14 },
  { value: "soup", pattern: /湯|羹|濃湯|清湯|高湯|味噌湯/i, weight: 12 },
  { value: "appetizer", pattern: /前菜|開胃|冷盤|沙拉|小點|amuse|entrée/i, weight: 11 },
  { value: "drink", pattern: /飲料|紅茶|綠茶|烏龍|咖啡|拿鐵|果汁|氣泡|汽水|可樂|調酒|葡萄酒|啤酒|奶茶/i, weight: 7 },
  { value: "staple", pattern: /飯|粥|麵|麵包|吐司|披薩|pizza|燉飯|烏龍麵|拉麵|義大利麵|米粉|冬粉|丼|壽司|餃|包子/i, weight: 9 },
  { value: "snack", pattern: /零食|點心|餅乾|洋芋片|糖果|堅果|鹹酥|炸物/i, weight: 8 },
  { value: "side", pattern: /配菜|小菜|附餐|漬物|醃菜/i, weight: 9 },
  { value: "main", pattern: /主菜|牛排|豬排|雞排|鴨胸|魚排|排餐|鍋物|套餐/i, weight: 9 },
  { value: "main", pattern: /牛|豬|雞|鴨|羊|魚|蝦|蟹|干貝|牡蠣|龍蝦/i, weight: 3 },
];

const ingredientRules: Rule<DishIngredientFamily>[] = [
  { value: "seafood", pattern: /魚|蝦|蟹|貝|干貝|鮭|鮪|章魚|花枝|牡蠣|龍蝦|海膽|魚卵|鰻/i, weight: 10 },
  { value: "meat", pattern: /牛|豬|雞|鴨|羊|肉|排骨|火腿|培根|香腸|鵝/i, weight: 10 },
  { value: "mushroom", pattern: /菇|蕈|松露|牛肝菌/i, weight: 10 },
  { value: "legume", pattern: /豆腐|豆皮|豆漿|毛豆|黃豆|鷹嘴豆|扁豆/i, weight: 10 },
  { value: "egg_dairy", pattern: /蛋|起司|乳酪|奶油|牛奶|鮮奶|優格|布丁|卡士達/i, weight: 8 },
  { value: "grain_noodle", pattern: /飯|米|粥|麵|麥|麵包|吐司|披薩|燉飯|粉|餃|包子/i, weight: 9 },
  { value: "fruit", pattern: /水果|莓|蘋果|香蕉|芒果|檸檬|柑橘|葡萄|鳳梨|水蜜桃|梨|荔枝/i, weight: 9 },
  { value: "vegetable", pattern: /菜|沙拉|筍|瓜|花椰|蘿蔔|番茄|茄子|菠菜|高麗菜|玉米|馬鈴薯|地瓜/i, weight: 8 },
  { value: "mixed", pattern: /綜合|拼盤|套餐|什錦/i, weight: 7 },
];

function rankMatches<T extends string>(text: string, rules: Rule<T>[]) {
  const scores = new Map<T, number>();
  rules.forEach((rule) => {
    if (rule.pattern.test(text)) scores.set(rule.value, (scores.get(rule.value) ?? 0) + rule.weight);
  });
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

export interface DishClassificationSuggestion {
  courseRole: DishCourseRole;
  courseRoleSuggestions: DishCourseRole[];
  ingredientFamilies: DishIngredientFamily[];
  ingredientSuggestions: DishIngredientFamily[];
}

export function suggestDishClassification(name: string, description = ""): DishClassificationSuggestion {
  const text = `${name.trim()} ${description.trim()}`;
  const rankedRoles = rankMatches(text, roleRules);
  const rankedIngredients = rankMatches(text, ingredientRules);
  const courseRole = rankedRoles[0]?.[0] ?? "main";
  const roleFallbacks: DishCourseRole[] = courseRole === "dessert"
    ? ["dessert", "snack", "drink", "other"]
    : courseRole === "drink"
      ? ["drink", "dessert", "other"]
      : courseRole === "soup"
        ? ["soup", "appetizer", "side", "other"]
        : ["main", "appetizer", "side", "other"];
  const ingredientFallbacks: DishIngredientFamily[] = courseRole === "dessert"
    ? ["egg_dairy", "fruit", "grain_noodle", "other"]
    : courseRole === "drink"
      ? ["fruit", "egg_dairy", "other"]
      : ["meat", "seafood", "vegetable", "other"];
  const courseRoleSuggestions = [...new Set([
    ...rankedRoles.slice(0, 3).map(([value]) => value),
    courseRole,
    ...roleFallbacks,
  ])].slice(0, 4);
  const ingredientFamilies = rankedIngredients.slice(0, 3).map(([value]) => value);
  const ingredientSuggestions = [...new Set([
    ...rankedIngredients.slice(0, 4).map(([value]) => value),
    ...ingredientFallbacks,
  ])].slice(0, 5);

  return { courseRole, courseRoleSuggestions, ingredientFamilies, ingredientSuggestions };
}

export function visualCategoryForClassification(
  name: string,
  description: string,
  courseRole: DishCourseRole,
  ingredients: DishIngredientFamily[],
): DishCategory {
  if (courseRole === "dessert") return "dessert";
  if (courseRole === "drink") return "drink";
  if (courseRole === "soup") return "soup";

  const text = `${name} ${description}`;
  if (/餃|燒賣|包子|小籠包|餛飩/i.test(text)) return "dumpling";
  if (/麵包|吐司|披薩|pizza|可頌|佛卡夏/i.test(text)) return "bread_pizza";
  if (/麵|烏龍|拉麵|義大利麵|米粉|冬粉/i.test(text)) return "noodle";
  if (/飯|燉飯|粥|丼|壽司/i.test(text)) return "rice";
  if (ingredients.includes("seafood")) return "seafood";
  if (ingredients.includes("meat")) return "meat";
  if (ingredients.some((item) => item === "vegetable" || item === "mushroom" || item === "legume")) return "vegetable";
  return "other";
}

export function matchesDishClassification(
  dish: Pick<Dish, "courseRole" | "ingredientFamilies">,
  filter: DishClassificationFilter,
) {
  const roleMatches = !filter.courseRoles?.length
    || (dish.courseRole ? filter.courseRoles.includes(dish.courseRole) : false);
  const ingredientMatches = !filter.ingredientFamilies?.length
    || filter.ingredientFamilies.some((ingredient) => dish.ingredientFamilies?.includes(ingredient));
  return roleMatches && ingredientMatches;
}

export function dishClassificationSummary(dish: Pick<Dish, "courseRole" | "ingredientFamilies">) {
  const role = dish.courseRole ?? "other";
  return [
    courseRoleLabels[role],
    ...(dish.ingredientFamilies ?? []).slice(0, 2).map((item) => ingredientFamilyLabels[item]),
  ].join(" · ");
}
