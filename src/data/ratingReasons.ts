import type {
  Dish,
  DishCourseRole,
  DishIngredientFamily,
  DishKind,
} from "../types";

type ScoreBand = "low" | "middle" | "high" | "top";

interface ReasonSet {
  prompt: string;
  tags: string[];
}

interface ReasonProfile {
  label: string;
  bands: Record<ScoreBand, ReasonSet>;
}

const commonBands: Record<ScoreBand, string[]> = {
  low: ["調味失衡", "沒有記憶點"],
  middle: ["調味安全", "表現普通"],
  high: ["味道平衡", "搭配合理"],
  top: ["層次驚艷", "值得再點"],
};

const seafoodBands: Record<ScoreBand, string[]> = {
  low: ["腥味明顯", "熟度過頭"],
  middle: ["鮮味普通", "熟度尚可"],
  high: ["鮮味乾淨", "熟度剛好"],
  top: ["鮮味很立體", "熟度精準"],
};

const meatBands: Record<ScoreBand, string[]> = {
  low: ["肉質乾柴", "吃起來油膩"],
  middle: ["肉質普通", "熟度尚可"],
  high: ["肉汁飽滿", "焦香漂亮"],
  top: ["肉質出色", "香氣難忘"],
};

const vegetableBands: Record<ScoreBand, string[]> = {
  low: ["菜味生澀", "口感軟爛"],
  middle: ["清爽普通", "口感尚可"],
  high: ["爽脆新鮮", "蔬香乾淨"],
  top: ["蔬味很立體", "口感驚喜"],
};

const grainBands: Record<ScoreBand, string[]> = {
  low: ["口感糊爛", "乾硬難入口"],
  middle: ["口感普通", "份量尚可"],
  high: ["口感剛好", "香氣舒服"],
  top: ["口感非常精準", "越吃越香"],
};

const dessertBands: Record<ScoreBand, string[]> = {
  low: ["太甜", "收尾太膩"],
  middle: ["甜度普通", "口感單一"],
  high: ["甜度平衡", "口感有變化"],
  top: ["甜度非常精準", "完美收尾"],
};

const drinkBands: Record<ScoreBand, string[]> = {
  low: ["香氣不自然", "濃淡失衡"],
  middle: ["香氣普通", "濃淡尚可"],
  high: ["香氣舒服", "濃淡剛好"],
  top: ["香氣很有層次", "尾韻漂亮"],
};

const soupBands: Record<ScoreBand, string[]> = {
  low: ["湯味混濁", "過鹹油膩"],
  middle: ["湯頭普通", "濃淡尚可"],
  high: ["湯頭乾淨", "濃淡剛好"],
  top: ["湯頭很有深度", "尾韻舒服"],
};

const profiles: Record<"overall" | "general", ReasonProfile> = {
  general: {
    label: "料理",
    bands: {
      low: { prompt: "是哪裡不合胃口？", tags: commonBands.low },
      middle: { prompt: "最接近你的感受？", tags: commonBands.middle },
      high: { prompt: "哪裡做得不錯？", tags: commonBands.high },
      top: { prompt: "它為什麼這麼好吃？", tags: commonBands.top },
    },
  },
  overall: {
    label: "整體用餐",
    bands: {
      low: { prompt: "整體哪裡最扣分？", tags: ["服務不順", "出餐節奏差", "環境不舒適", "不會再訪"] },
      middle: { prompt: "這次用餐最接近？", tags: ["流程還算順", "服務普通", "氣氛尚可", "餐點落差大"] },
      high: { prompt: "整體哪裡值得肯定？", tags: ["服務貼心", "節奏舒服", "氣氛有加分", "會想再訪"] },
      top: { prompt: "為什麼值得再訪？", tags: ["全程很完整", "服務有記憶點", "氛圍難忘", "物有所值"] },
    },
  },
};

export function scoreBand(score: number): ScoreBand {
  if (score < 38) return "low";
  if (score < 65) return "middle";
  if (score < 86) return "high";
  return "top";
}

function legacyClassification(kind: DishKind) {
  if (kind === "dessert") return { role: "dessert" as const, ingredients: [] as DishIngredientFamily[] };
  if (kind === "meat") return { role: "main" as const, ingredients: ["meat" as const] };
  if (kind === "seafood") return { role: "main" as const, ingredients: ["seafood" as const] };
  return { role: "other" as const, ingredients: [] as DishIngredientFamily[] };
}

function specialtyFor(role: DishCourseRole, ingredients: DishIngredientFamily[], band: ScoreBand) {
  if (role === "dessert") return { label: "甜點", prompt: band === "low" ? "甜點哪裡失手？" : band === "top" ? "為什麼想再吃一次？" : undefined, tags: dessertBands[band] };
  if (role === "drink") return { label: "飲料", tags: drinkBands[band] };
  if (role === "soup") return { label: "湯品", tags: soupBands[band] };
  if (ingredients.includes("seafood")) return { label: "海鮮", tags: seafoodBands[band] };
  if (ingredients.includes("meat")) return { label: "肉類", tags: meatBands[band] };
  if (ingredients.some((item) => item === "vegetable" || item === "mushroom" || item === "legume")) return { label: "蔬食", tags: vegetableBands[band] };
  if (role === "staple" || ingredients.includes("grain_noodle")) return { label: "主食", tags: grainBands[band] };
  return { label: "料理", tags: [] as string[] };
}

export function reasonsFor(dishOrKind: Pick<Dish, "kind" | "courseRole" | "ingredientFamilies" | "overall"> | DishKind, score: number) {
  const kind = typeof dishOrKind === "string" ? dishOrKind : dishOrKind.kind;
  if (kind === "overall" || (typeof dishOrKind !== "string" && dishOrKind.overall)) {
    const set = profiles.overall.bands[scoreBand(score)];
    return { label: profiles.overall.label, ...set };
  }

  const legacy = legacyClassification(kind);
  const role = typeof dishOrKind === "string" ? legacy.role : dishOrKind.courseRole ?? legacy.role;
  const ingredients = typeof dishOrKind === "string" ? legacy.ingredients : dishOrKind.ingredientFamilies ?? legacy.ingredients;
  const band = scoreBand(score);
  const general = profiles.general.bands[band];
  const specialty = specialtyFor(role, ingredients, band);
  const tags = [...new Set([...specialty.tags, ...commonBands[band]])].slice(0, 4);
  return { label: specialty.label, prompt: specialty.prompt ?? general.prompt, tags };
}

export function scoreLabel(score: number) {
  if (score < 25) return "真的不行";
  if (score < 45) return "不太合胃口";
  if (score < 65) return "普通";
  if (score < 82) return "滿喜歡的";
  if (score < 94) return "會想再吃";
  return "今晚最佳";
}
