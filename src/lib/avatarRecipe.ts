import type { AvatarRecipe } from "../types";

export const AVATAR_HEAD_OPTIONS = [
  "fluffy-bob", "round-bob", "short", "curly-short", "short-bangs", "side-swept-short",
  "messy-short", "wavy-medium", "flipped-long", "lob", "long-straight", "side-swept-lob",
  "blunt-bob", "bun", "low-side-bun", "low-twin-buns", "ponytail", "low-ponytail",
  "low-twin-tails", "braids", "blunt-long", "side-swept-long", "wavy-long", "curly-long",
] as const;

export const AVATAR_BODY_OPTIONS = [
  "cropped-shirt", "tank-top", "drape-tee", "polo", "tee", "shirt", "jacket", "hoodie",
] as const;

export const AVATAR_GLASSES_OPTIONS = ["none", "round", "tiny"] as const;

export const AVATAR_ITEM_OPTIONS = [
  "none", "crab-headband", "tuna-sushi", "shrimp-sushi", "sprout", "beer", "antennae",
  "bunny-ears", "halo", "crown", "flower", "ice-cream", "duck", "santa-hat", "camera",
  "wind-chime", "frog-alt", "ramune", "takoyaki", "chocolate-banana", "yoyo", "beach-ball",
  "sunflower", "eggplant", "shark", "fox-mask", "banana", "watermelon", "pineapple",
  "candied-apple", "sunglasses", "goggles", "tabby-cat", "cream-cat", "ginger-cat",
  "white-cat", "black-cat", "tuxedo-cat", "siamese-cat", "gray-cat", "tabby-tuxedo-cat",
  "calico-cat", "brown-tabby-cat",
] as const;

export const AVATAR_HAIR_COLORS = [
  "#241F1B", "#4A4038", "#6B5142", "#D0A47B",
  "#E6C66A", "#EFE5D2", "#F4F2EC", "#D77A48",
  "#A94E4E", "#D98DA5", "#E7A6B5", "#5B7FB9",
  "#3F527A", "#4F9B94", "#806CA8", "#6F9A6D",
] as const;

export const AVATAR_SKIN_COLORS = [
  "#F7D8BE", "#F2C9A8", "#EFC3A0", "#E7B58F", "#DFA982", "#C98F69", "#A96F52", "#7F503C",
] as const;

export const AVATAR_CLOTHES_COLORS = [
  "#91B4A5", "#A8C89A", "#9EB9D8", "#C9A6C4", "#D4B878", "#AAA6CE", "#EE8C75", "#D7C6A1",
  "#6FA6B8", "#7E8D78", "#B96D6D", "#E2A45F",
] as const;

export const AVATAR_BACKGROUND_COLORS = [
  "#F2B7A8", "#E8C5B4", "#E8CF9F", "#E9DFAF",
  "#C6D8B5", "#B8D7CE", "#B9CDE8", "#C8C4E4",
  "#E7C9DF", "#D8C4B3", "#C9D0CF", "#E7DCD0",
] as const;

export const DEFAULT_AVATAR_RECIPE: AvatarRecipe = {
  head: "short",
  body: "tee",
  glasses: "none",
  item: "none",
  hair: "#4A4038",
  skin: "#F2C9A8",
  clothes: "#91B4A5",
  background: "#F2B7A8",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function option(value: unknown, choices: readonly string[], fallback: string): string {
  return typeof value === "string" && (choices as readonly string[]).includes(value)
    ? value
    : fallback;
}

export function normalizeAvatarRecipe(value: unknown): AvatarRecipe {
  const input = isRecord(value) ? value : {};
  return {
    head: option(input.head, AVATAR_HEAD_OPTIONS, DEFAULT_AVATAR_RECIPE.head),
    body: option(input.body, AVATAR_BODY_OPTIONS, DEFAULT_AVATAR_RECIPE.body),
    glasses: option(input.glasses, AVATAR_GLASSES_OPTIONS, DEFAULT_AVATAR_RECIPE.glasses),
    item: option(input.item, AVATAR_ITEM_OPTIONS, DEFAULT_AVATAR_RECIPE.item ?? "none"),
    hair: option(input.hair, AVATAR_HAIR_COLORS, DEFAULT_AVATAR_RECIPE.hair),
    skin: option(input.skin, AVATAR_SKIN_COLORS, DEFAULT_AVATAR_RECIPE.skin),
    clothes: option(input.clothes, AVATAR_CLOTHES_COLORS, DEFAULT_AVATAR_RECIPE.clothes),
    background: option(input.background, AVATAR_BACKGROUND_COLORS, DEFAULT_AVATAR_RECIPE.background ?? "#F2B7A8"),
  };
}

export function isAvatarRecipeConfigured(value: unknown) {
  if (!isRecord(value)) return false;
  return ["head", "body", "glasses", "hair", "skin", "clothes"].every(
    (key) => typeof value[key] === "string" && value[key].length > 0,
  );
}
