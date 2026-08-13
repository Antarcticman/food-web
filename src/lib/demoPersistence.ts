import { createDishVisualRecipe } from "../data/dishVisuals";
import type { Dish, DishCategory, DishVisualRecipe, ParticipationStatus, RatingDraft, RatingDrafts } from "../types";

export const demoV3Key = "tastelog.react-demo.v3";
const demoV2Key = "tastelog.react-demo.v2";

export interface SavedDemoV3 {
  version: 3;
  dishes: Dish[];
  ratings: RatingDrafts;
  activeDishId: string;
  ready: boolean;
  resultViewed?: boolean;
}

type LegacyDish = Omit<Dish, "category" | "visualRecipe" | "participantStatus"> & {
  category?: DishCategory;
  visualRecipe?: DishVisualRecipe;
  participantStatus: Record<string, string>;
};

interface LegacyRating {
  score?: number;
  selectedReasons?: string[];
  submitted?: boolean;
}

interface LegacySavedDemo {
  dishes?: LegacyDish[];
  ratings?: Record<string, LegacyRating>;
  activeDishId?: string;
}

function normalizeLegacyStatus(value: string | undefined, hasSubmittedRating = false): ParticipationStatus {
  if (value === "rated" || value === "completed") return hasSubmittedRating || value === "rated" ? "rated" : "opened";
  if (value === "not_eaten") return "not_eaten";
  if (value === "opened" || value === "skipped") return "opened";
  return "unopened";
}

function normalizeDish(raw: LegacyDish, currentParticipantId: string, legacyRating?: LegacyRating): Dish {
  const visualRecipe = raw.visualRecipe ?? createDishVisualRecipe(raw.name, raw.kind);
  const participantStatus = Object.fromEntries(
    Object.entries(raw.participantStatus ?? {}).map(([participantId, status]) => [
      participantId,
      normalizeLegacyStatus(status, participantId === currentParticipantId && Boolean(legacyRating?.submitted)),
    ]),
  ) as Record<string, ParticipationStatus>;

  return {
    ...raw,
    category: raw.category ?? visualRecipe.category,
    visualRecipe,
    participantStatus,
  };
}

function draftForDish(dish: Dish, currentParticipantId: string, legacy?: LegacyRating): RatingDraft {
  const now = new Date().toISOString();
  const state = dish.participantStatus[currentParticipantId] ?? "unopened";
  const score = typeof legacy?.score === "number" ? legacy.score : null;
  return {
    score,
    selectedReasons: Array.isArray(legacy?.selectedReasons) ? legacy.selectedReasons.slice(0, 3) : [],
    note: "",
    state,
    resumeState: state === "not_eaten" ? (score !== null && legacy?.submitted ? "rated" : "opened") : undefined,
    openedAt: state === "opened" || state === "rated" ? now : undefined,
    ratedAt: state === "rated" ? now : undefined,
    updatedAt: now,
  };
}

function migrateV2(parsed: LegacySavedDemo, currentParticipantId: string): SavedDemoV3 | null {
  if (!Array.isArray(parsed.dishes) || !parsed.ratings || !parsed.activeDishId) return null;
  const dishes = parsed.dishes.map((raw) => normalizeDish(raw, currentParticipantId, parsed.ratings?.[raw.id]));
  const ratings = Object.fromEntries(dishes.map((dish) => [
    dish.id,
    draftForDish(dish, currentParticipantId, parsed.ratings?.[dish.id]),
  ]));
  return {
    version: 3,
    dishes,
    ratings,
    activeDishId: dishes.some((dish) => dish.id === parsed.activeDishId) ? parsed.activeDishId : dishes[0]?.id ?? "",
    ready: false,
  };
}

function normalizeV3(parsed: SavedDemoV3, currentParticipantId: string): SavedDemoV3 | null {
  if (!Array.isArray(parsed.dishes) || !parsed.ratings || !parsed.activeDishId) return null;
  const dishes = parsed.dishes.map((raw) => normalizeDish(raw as LegacyDish, currentParticipantId));
  const ratings = Object.fromEntries(dishes.map((dish) => {
    const saved = parsed.ratings[dish.id];
    if (!saved) return [dish.id, draftForDish(dish, currentParticipantId)];
    const state = normalizeLegacyStatus(saved.state, saved.state === "rated");
    return [dish.id, {
      ...saved,
      score: typeof saved.score === "number" ? saved.score : null,
      state,
      selectedReasons: Array.isArray(saved.selectedReasons) ? saved.selectedReasons.slice(0, 3) : [],
      note: typeof saved.note === "string" ? saved.note.slice(0, 300) : "",
      updatedAt: saved.updatedAt ?? new Date().toISOString(),
    } satisfies RatingDraft];
  })) as RatingDrafts;
  return {
    version: 3,
    dishes,
    ratings,
    activeDishId: parsed.activeDishId,
    ready: Boolean(parsed.ready),
    resultViewed: Boolean(parsed.resultViewed),
  };
}

export function loadSavedDemo(currentParticipantId: string): SavedDemoV3 | null {
  try {
    const v3Value = window.localStorage.getItem(demoV3Key);
    if (v3Value) return normalizeV3(JSON.parse(v3Value) as SavedDemoV3, currentParticipantId);
    const v2Value = window.localStorage.getItem(demoV2Key);
    if (!v2Value) return null;
    return migrateV2(JSON.parse(v2Value) as LegacySavedDemo, currentParticipantId);
  } catch {
    return null;
  }
}
