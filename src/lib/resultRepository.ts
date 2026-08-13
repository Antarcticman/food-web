import type { SupabaseClient } from "@supabase/supabase-js";
import type { DishCategory, DishVisualRecipe, HistoricalOverallResult } from "../types";
import { getSupabaseClient } from "./supabase";

export interface PersistedResultIndividualScore {
  userId: string;
  name: string;
  score: number;
  reasons: string[];
  note?: string;
}

export interface PersistedResultDish {
  dishId: string;
  restaurantDishId?: string;
  name: string;
  kind: string;
  category: DishCategory;
  visualRecipe: DishVisualRecipe;
  isOverall: boolean;
  average?: number;
  ratingCount: number;
  individualScores?: PersistedResultIndividualScore[];
}

export interface PersistedResultSnapshot {
  schemaVersion: number;
  visitId: string;
  version: number;
  revealedAt: string;
  revealIndividualScores: boolean;
  rankingRules: {
    minimumDishCount: number;
    minimumPodiumScore: number;
    tieRule: "average_and_rating_count";
    personWeighting: "equal_after_person_visit_average";
  };
  dishes: PersistedResultDish[];
}

export interface RestaurantDishLeaderboardRow {
  restaurantDishId: string;
  displayName: string;
  category: DishCategory;
  visualRecipe: DishVisualRecipe;
  average: number;
  peopleCount: number;
  ratingCount: number;
}

function requireClient(client?: SupabaseClient | null) {
  const resolved = client ?? getSupabaseClient();
  if (!resolved) throw new Error("Supabase 尚未設定；請先提供 VITE_SUPABASE_URL 與 VITE_SUPABASE_PUBLISHABLE_KEY。");
  return resolved;
}

function assertSnapshot(value: unknown): PersistedResultSnapshot {
  if (!value || typeof value !== "object") throw new Error("結果快照格式錯誤。");
  const snapshot = value as Partial<PersistedResultSnapshot>;
  if (!snapshot.visitId || !snapshot.version || !Array.isArray(snapshot.dishes)) {
    throw new Error("結果快照缺少必要欄位。");
  }
  return {
    schemaVersion: snapshot.schemaVersion ?? 1,
    visitId: snapshot.visitId,
    version: snapshot.version,
    revealedAt: snapshot.revealedAt ?? "",
    revealIndividualScores: snapshot.revealIndividualScores ?? false,
    rankingRules: snapshot.rankingRules ?? {
      minimumDishCount: 3,
      minimumPodiumScore: 60,
      tieRule: "average_and_rating_count",
      personWeighting: "equal_after_person_visit_average",
    },
    dishes: snapshot.dishes,
  };
}

export async function setVisitReady(visitId: string, ready: boolean, client?: SupabaseClient | null) {
  const { data, error } = await requireClient(client).rpc("set_visit_ready", {
    target_visit: visitId,
    ready,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function revealVisit(visitId: string, client?: SupabaseClient | null) {
  const { data, error } = await requireClient(client).rpc("reveal_visit", { target_visit: visitId });
  if (error) throw error;
  return Number(data);
}

export async function loadResultSnapshot(
  visitId: string,
  version?: number,
  client?: SupabaseClient | null,
) {
  let query = requireClient(client)
    .from("result_versions")
    .select("version, snapshot")
    .eq("visit_id", visitId);

  query = version === undefined
    ? query.order("version", { ascending: false }).limit(1)
    : query.eq("version", version).limit(1);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return assertSnapshot(data.snapshot);
}

export async function markResultViewed(
  visitId: string,
  version: number,
  client?: SupabaseClient | null,
) {
  const { data, error } = await requireClient(client).rpc("mark_result_viewed", {
    target_visit: visitId,
    target_version: version,
  });
  if (error) throw error;
  return String(data);
}

export async function linkRestaurantDish(
  dishId: string,
  options: { restaurantDishId?: string; versionLabel?: string } = {},
  client?: SupabaseClient | null,
) {
  const { data, error } = await requireClient(client).rpc("link_restaurant_dish", {
    target_dish: dishId,
    requested_restaurant_dish: options.restaurantDishId ?? null,
    requested_version_label: options.versionLabel ?? null,
  });
  if (error) throw error;
  return String(data);
}

export async function loadRestaurantDishLeaderboard(
  restaurantId: string,
  client?: SupabaseClient | null,
): Promise<RestaurantDishLeaderboardRow[]> {
  const { data, error } = await requireClient(client).rpc("get_restaurant_dish_leaderboard", {
    target_restaurant: restaurantId,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    restaurantDishId: String(row.restaurant_dish_id),
    displayName: String(row.display_name),
    category: row.category as DishCategory,
    visualRecipe: row.visual_recipe as DishVisualRecipe,
    average: Number(row.average),
    peopleCount: Number(row.people_count),
    ratingCount: Number(row.rating_count),
  }));
}

export async function loadRestaurantOverallHistory(
  restaurantId: string,
  client?: SupabaseClient | null,
): Promise<HistoricalOverallResult | null> {
  const { data, error } = await requireClient(client).rpc("get_restaurant_history_summary", {
    target_restaurant: restaurantId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  if (!row || row.average === null || Number(row.people_count) === 0) return null;
  return {
    average: Number(row.average),
    peopleCount: Number(row.people_count),
    visitCount: Number(row.visit_count),
    ratingCount: Number(row.rating_count),
  };
}
