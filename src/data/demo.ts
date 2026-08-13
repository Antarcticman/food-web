import { createDishVisualRecipe } from "./dishVisuals";
import type { Dish, Participant, RatingDrafts } from "../types";

export const currentParticipantId = "anta";

export const participants: Participant[] = [
  {
    id: "anta",
    name: "安塔",
    color: "#f2b7a8",
    avatar: { head: "fluffy-bob", body: "tee", glasses: "round", hair: "#4A4038", skin: "#F2C9A8", clothes: "#91B4A5" },
  },
  {
    id: "mina",
    name: "Mina",
    color: "#c6d8b5",
    avatar: { head: "round-bob", body: "cropped-shirt", glasses: "none", hair: "#6B5142", skin: "#EFC3A0", clothes: "#A8C89A" },
  },
  {
    id: "jack",
    name: "Jack",
    color: "#b9cde8",
    avatar: { head: "short", body: "shirt", glasses: "tiny", hair: "#2F3A43", skin: "#E7B58F", clothes: "#9EB9D8" },
  },
  {
    id: "zoe",
    name: "Zoe",
    color: "#e7c9df",
    avatar: { head: "bun", body: "drape-tee", glasses: "none", hair: "#593F38", skin: "#F0C6A7", clothes: "#C9A6C4" },
  },
  {
    id: "kai",
    name: "Kai",
    color: "#e8cf9f",
    avatar: { head: "messy-short", body: "polo", glasses: "round", hair: "#3D362F", skin: "#DFA982", clothes: "#D4B878" },
  },
  {
    id: "yu",
    name: "Yu",
    color: "#c8c4e4",
    avatar: { head: "long-straight", body: "tank-top", glasses: "none", hair: "#302D3B", skin: "#F1C3A5", clothes: "#AAA6CE" },
  },
];

function dish(input: Omit<Dish, "category" | "visualRecipe">): Dish {
  const visualRecipe = createDishVisualRecipe(input.name, input.kind);
  return { ...input, category: visualRecipe.category, visualRecipe };
}

export const previewDish: Dish = {
  ...dish({
    id: "scene-preview",
    order: 998,
    name: "罩蓋測試盤",
    description: "本機場景預覽，不列入評分統計",
    kind: "seafood",
    confirmation: "confirmed",
    previewOnly: true,
    participantStatus: {},
  }),
  visualRecipe: {
    ...createDishVisualRecipe("罩蓋測試盤", "seafood"),
    base: "preview-scallop",
    palette: "mint",
  },
};

export function withPreviewDish(dishes: Dish[]) {
  const withoutPreview = dishes.filter((item) => item.id !== previewDish.id);
  const overallIndex = withoutPreview.findIndex((item) => item.overall);
  if (overallIndex < 0) return [...withoutPreview, previewDish];
  return [
    ...withoutPreview.slice(0, overallIndex),
    previewDish,
    ...withoutPreview.slice(overallIndex),
  ];
}

export const initialDishes: Dish[] = [
  dish({
    id: "scallop",
    order: 1,
    name: "炙燒干貝",
    description: "白花椰 · 柚子胡椒 · 發酵奶油",
    kind: "seafood",
    confirmation: "confirmed",
    price: 680,
    participantStatus: { anta: "rated", mina: "rated", jack: "unopened", zoe: "rated", kai: "not_eaten", yu: "opened" },
  }),
  dish({
    id: "duck",
    order: 2,
    name: "粉紅鴨胸",
    description: "無花果 · 紅酒醬汁 · 炭烤菊苣",
    kind: "meat",
    confirmation: "confirmed",
    participantStatus: { anta: "opened", mina: "rated", jack: "rated", zoe: "unopened", kai: "rated", yu: "not_eaten" },
  }),
  dish({
    id: "pudding",
    order: 3,
    name: "焦糖布丁",
    description: "鹽之花 · 初榨橄欖油 · 香草籽",
    kind: "dessert",
    confirmation: "confirmed",
    price: 320,
    participantStatus: { anta: "unopened", mina: "rated", jack: "unopened", zoe: "rated", kai: "unopened", yu: "rated" },
  }),
  previewDish,
  dish({
    id: "overall",
    order: 999,
    name: "整體用餐",
    description: "餐點 · 服務 · 氣氛 · 是否想再訪",
    kind: "overall",
    confirmation: "confirmed",
    overall: true,
    participantStatus: { anta: "unopened", mina: "unopened", jack: "unopened", zoe: "unopened", kai: "unopened", yu: "unopened" },
  }),
];

const now = new Date().toISOString();

export const initialRatings: RatingDrafts = {
  scallop: { score: 68, selectedReasons: ["鮮味乾淨"], note: "", state: "rated", ratedAt: now, updatedAt: now },
  duck: { score: 74, selectedReasons: [], note: "", state: "opened", openedAt: now, updatedAt: now },
  pudding: { score: null, selectedReasons: [], note: "", state: "unopened", updatedAt: now },
  "scene-preview": { score: null, selectedReasons: [], note: "", state: "unopened", updatedAt: now },
  overall: { score: null, selectedReasons: [], note: "", state: "unopened", updatedAt: now },
};
