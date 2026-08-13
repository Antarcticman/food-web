import type { RealtimeChannel } from "@supabase/supabase-js";
import { createDishVisualRecipe } from "../data/dishVisuals";
import { visualCategoryForClassification } from "../data/dishClassification";
import type {
  Dish,
  DishCategory,
  DishConfirmation,
  DishCourseRole,
  DishIngredientFamily,
  DishKind,
  DishVisualRecipe,
  NewDishInput,
  Participant,
  ParticipationStatus,
  RatingDrafts,
} from "../types";
import { normalizeAvatarRecipe } from "./avatarRecipe";
import { linkRestaurantDish } from "./resultRepository";
import { getSupabaseClient } from "./supabase";

type VisitStatus = "active" | "revealed" | "closed";

interface VisitRow {
  id: string;
  status: VisitStatus;
  current_result_version: number;
}

interface ParticipantRow {
  user_id: string;
  joined_at: string;
  ready_at: string | null;
  excluded_at: string | null;
  profile: {
    display_name: string;
    avatar_recipe: unknown;
  } | {
    display_name: string;
    avatar_recipe: unknown;
  }[] | null;
}

interface DishRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  category: DishCategory;
  visual_recipe: unknown;
  course_order: number;
  is_overall: boolean;
  confirmation: DishConfirmation;
  price: number | null;
  course_role: DishCourseRole;
  ingredient_families: DishIngredientFamily[];
}

interface ConsumerRow {
  dish_id: string;
  status: ParticipationStatus;
  resume_status: ParticipationStatus | null;
  opened_at: string | null;
  updated_at: string;
}

interface ProgressRow {
  dish_id: string;
  user_id: string;
  public_status: "unopened" | "rated" | "not_eaten";
}

interface RatingRow {
  dish_id: string;
  score: number;
  reasons: string[];
  rated_at: string;
  updated_at: string;
}

export interface VisitRoomParticipant extends Participant {
  joinedAt: string;
  ready: boolean;
}

export interface VisitRatingState {
  visitStatus: VisitStatus;
  resultVersion: number;
  dishes: Dish[];
  ratings: RatingDrafts;
  participants: VisitRoomParticipant[];
  ready: boolean;
  everyoneReady: boolean;
}

export interface CreateVisitDishInput extends NewDishInput {
  visitId: string;
  userId: string;
}

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase 尚未設定完成。");
  return client;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isMissingClassificationSchema(error: { code?: string; message?: string } | null) {
  return Boolean(error && (
    error.code === "42703"
    || error.code === "PGRST204"
    || error.message?.includes("course_role")
    || error.message?.includes("ingredient_families")
  ));
}

async function loadDishRows(client: ReturnType<typeof requireClient>, visitId: string) {
  const current = await client
    .from("dishes")
    .select("id, name, description, kind, category, visual_recipe, course_order, is_overall, confirmation, price, course_role, ingredient_families")
    .eq("visit_id", visitId)
    .is("deleted_at", null)
    .order("course_order", { ascending: true });

  if (!current.error) {
    return { rows: (current.data ?? []) as unknown as DishRow[], error: null };
  }
  if (!isMissingClassificationSchema(current.error)) return { rows: [] as DishRow[], error: current.error };

  const legacy = await client
    .from("dishes")
    .select("id, name, description, kind, category, visual_recipe, course_order, is_overall, confirmation, price")
    .eq("visit_id", visitId)
    .is("deleted_at", null)
    .order("course_order", { ascending: true });
  const rows = ((legacy.data ?? []) as unknown as Omit<DishRow, "course_role" | "ingredient_families">[])
    .map((row) => ({ ...row, course_role: "other" as const, ingredient_families: [] }));
  return { rows, error: legacy.error };
}

function kindFor(row: Pick<DishRow, "kind" | "category" | "is_overall">): DishKind {
  if (row.is_overall) return "overall";
  if (row.kind === "dessert" || row.category === "dessert") return "dessert";
  if (row.kind === "meat" || row.category === "meat") return "meat";
  return "seafood";
}

function visualFor(row: DishRow): DishVisualRecipe {
  const fallback = createDishVisualRecipe(row.name, kindFor(row));
  if (!row.visual_recipe || typeof row.visual_recipe !== "object") return fallback;
  const value = row.visual_recipe as Partial<DishVisualRecipe>;
  return {
    ...fallback,
    ...value,
    category: row.category,
    seed: typeof value.seed === "number" ? value.seed : fallback.seed,
  };
}

export async function loadVisitRatingState(visitId: string, currentUserId: string): Promise<VisitRatingState> {
  const client = requireClient();
  const [visitResult, participantResult, dishLoad] = await Promise.all([
    client
      .from("visits")
      .select("id, status, current_result_version")
      .eq("id", visitId)
      .is("deleted_at", null)
      .single<VisitRow>(),
    client
      .from("visit_participants")
      .select(`
        user_id,
        joined_at,
        ready_at,
        excluded_at,
        profile:profiles!visit_participants_user_id_fkey (
          display_name,
          avatar_recipe
        )
      `)
      .eq("visit_id", visitId)
      .is("excluded_at", null)
      .order("joined_at", { ascending: true }),
    loadDishRows(client, visitId),
  ]);

  if (visitResult.error) throw visitResult.error;
  if (participantResult.error) throw participantResult.error;
  if (dishLoad.error) throw dishLoad.error;

  const visit = visitResult.data;
  const participantRows = (participantResult.data ?? []) as unknown as ParticipantRow[];
  const dishRows = dishLoad.rows;
  const dishIds = dishRows.map((dish) => dish.id);

  const participants: VisitRoomParticipant[] = participantRows.map((row) => {
    const profile = one(row.profile);
    const avatar = normalizeAvatarRecipe(profile?.avatar_recipe);
    return {
      id: row.user_id,
      name: profile?.display_name ?? "朋友",
      color: avatar.background ?? "#D8CDBE",
      avatar,
      joinedAt: row.joined_at,
      ready: Boolean(row.ready_at),
    };
  });

  if (!dishIds.length) {
    return {
      visitStatus: visit.status,
      resultVersion: visit.current_result_version,
      dishes: [],
      ratings: {},
      participants,
      ready: participants.find((participant) => participant.id === currentUserId)?.ready ?? false,
      everyoneReady: participants.length > 0 && participants.every((participant) => participant.ready),
    };
  }

  const [consumerResult, progressResult, ratingResult] = await Promise.all([
    client
      .from("dish_consumers")
      .select("dish_id, status, resume_status, opened_at, updated_at")
      .eq("user_id", currentUserId)
      .in("dish_id", dishIds),
    client
      .from("dish_consumer_progress")
      .select("dish_id, user_id, public_status")
      .in("dish_id", dishIds),
    client
      .from("ratings")
      .select("dish_id, score, reasons, rated_at, updated_at")
      .eq("user_id", currentUserId)
      .in("dish_id", dishIds),
  ]);

  if (consumerResult.error) throw consumerResult.error;
  if (progressResult.error) throw progressResult.error;
  if (ratingResult.error) throw ratingResult.error;

  const consumers = (consumerResult.data ?? []) as ConsumerRow[];
  const progress = (progressResult.data ?? []) as ProgressRow[];
  const ratingRows = (ratingResult.data ?? []) as RatingRow[];
  const ratingsByDish = new Map(ratingRows.map((rating) => [rating.dish_id, rating]));
  const consumerByDish = new Map(consumers.map((consumer) => [consumer.dish_id, consumer]));
  const progressByDishAndUser = new Map(progress.map((item) => [`${item.dish_id}:${item.user_id}`, item.public_status]));

  const dishes: Dish[] = dishRows.map((row) => {
    const participantStatus = Object.fromEntries(participants.flatMap((participant) => {
      const own = participant.id === currentUserId ? consumerByDish.get(row.id)?.status : undefined;
      const visible = progressByDishAndUser.get(`${row.id}:${participant.id}`);
      const status = own ?? visible;
      return status ? [[participant.id, status]] : [];
    })) as Record<string, ParticipationStatus>;
    return {
      id: row.id,
      order: Number(row.course_order),
      name: row.name,
      description: row.description ?? "",
      kind: kindFor(row),
      category: row.category,
      courseRole: row.course_role,
      ingredientFamilies: row.ingredient_families ?? [],
      visualRecipe: visualFor(row),
      confirmation: row.confirmation,
      price: row.price === null ? undefined : Number(row.price),
      overall: row.is_overall,
      participantStatus,
    };
  });

  const now = new Date().toISOString();
  const ratings: RatingDrafts = Object.fromEntries(dishRows.map((dish) => {
    const consumer = consumerByDish.get(dish.id);
    const rating = ratingsByDish.get(dish.id);
    return [dish.id, {
      score: rating?.score ?? null,
      selectedReasons: rating?.reasons ?? [],
      state: consumer?.status ?? "unopened",
      resumeState: consumer?.resume_status && consumer.resume_status !== "not_eaten"
        ? consumer.resume_status
        : undefined,
      openedAt: consumer?.opened_at ?? undefined,
      ratedAt: rating?.rated_at ?? undefined,
      updatedAt: rating?.updated_at ?? consumer?.updated_at ?? now,
    }];
  }));

  return {
    visitStatus: visit.status,
    resultVersion: visit.current_result_version,
    dishes,
    ratings,
    participants,
    ready: participants.find((participant) => participant.id === currentUserId)?.ready ?? false,
    everyoneReady: participants.length > 0 && participants.every((participant) => participant.ready),
  };
}

export async function openVisitDish(dishId: string, currentUserId: string) {
  const { error } = await requireClient()
    .from("dish_consumers")
    .update({ status: "opened", opened_at: new Date().toISOString(), resume_status: null })
    .eq("dish_id", dishId)
    .eq("user_id", currentUserId);
  if (error) throw error;
}

export async function saveVisitRating(dishId: string, currentUserId: string, score: number, reasons: string[]) {
  const { error } = await requireClient()
    .from("ratings")
    .upsert({ dish_id: dishId, user_id: currentUserId, score, reasons: reasons.slice(0, 3) }, { onConflict: "dish_id,user_id" });
  if (error) throw error;
}

export async function setVisitDishConsumption(
  dishId: string,
  currentUserId: string,
  status: ParticipationStatus,
  resumeStatus?: ParticipationStatus,
) {
  const { error } = await requireClient()
    .from("dish_consumers")
    .update({
      status,
      resume_status: status === "not_eaten" ? resumeStatus ?? "opened" : null,
      opened_at: status === "unopened" ? null : new Date().toISOString(),
    })
    .eq("dish_id", dishId)
    .eq("user_id", currentUserId);
  if (error) throw error;
}

export async function confirmVisitDish(dishId: string, currentUserId: string) {
  const { error } = await requireClient()
    .from("dishes")
    .update({ confirmation: "confirmed", confirmed_by: currentUserId, confirmed_at: new Date().toISOString() })
    .eq("id", dishId);
  if (error) throw error;
  await linkRestaurantDish(dishId);
}

export async function updateVisitDishClassification(
  dish: Pick<Dish, "id" | "name" | "description" | "kind">,
  courseRole: DishCourseRole,
  ingredientFamilies: DishIngredientFamily[],
) {
  const cleanedIngredients = ingredientFamilies.slice(0, 3);
  const category = visualCategoryForClassification(dish.name, dish.description, courseRole, cleanedIngredients);
  const visual = createDishVisualRecipe(dish.name, dish.kind, category);
  const { error } = await requireClient().rpc("update_visit_dish_classification", {
    target_dish: dish.id,
    dish_course_role: courseRole,
    dish_ingredient_families: cleanedIngredients,
    dish_category: category,
    dish_visual_recipe: visual,
  });
  if (error) throw error;
  return { category, visualRecipe: visual };
}

export async function updateVisitDishDetails(dishId: string, name: string, description: string) {
  const cleanedName = name.trim().slice(0, 180);
  if (!cleanedName) throw new Error("請輸入菜名");
  const { error } = await requireClient().rpc("update_visit_dish_details", {
    target_dish: dishId,
    requested_name: cleanedName,
    requested_description: description.trim().slice(0, 400),
  });
  if (error) throw error;
}

export async function setVisitDishConsumers(dishId: string, participantIds: string[]) {
  const { error } = await requireClient().rpc("set_visit_dish_consumers", {
    target_dish: dishId,
    requested_users: [...new Set(participantIds)],
  });
  if (error) throw error;
}

export async function deleteVisitDish(dishId: string) {
  const { error } = await requireClient().rpc("delete_visit_dish", { target_dish: dishId });
  if (error) throw error;
}

export async function restoreVisitDish(dishId: string) {
  const { error } = await requireClient().rpc("restore_visit_dish", { target_dish: dishId });
  if (error) throw error;
}

export async function createVisitDish(input: CreateVisitDishInput) {
  const name = input.name.trim().slice(0, 180);
  if (!name) throw new Error("請輸入菜名。");
  const description = input.description.trim().slice(0, 400);
  const ingredientFamilies = input.ingredientFamilies.slice(0, 3);
  const category = visualCategoryForClassification(name, description, input.courseRole, ingredientFamilies);
  const visual = createDishVisualRecipe(name, "seafood", category);
  const kind: DishKind = visual.category === "dessert" ? "dessert" : visual.category === "meat" ? "meat" : "seafood";
  const client = requireClient();
  const current = await client.rpc("create_visit_dish", {
    target_visit: input.visitId,
    dish_name: name,
    dish_description: description,
    dish_kind: kind,
    dish_category: visual.category,
    dish_visual_recipe: visual,
    dish_course_role: input.courseRole,
    dish_ingredient_families: ingredientFamilies,
  });
  if (!current.error) return String(current.data);

  const isOldRpc = current.error.code === "PGRST202"
    || current.error.code === "42883"
    || current.error.message?.includes("dish_course_role");
  if (!isOldRpc) throw current.error;

  const legacy = await client.rpc("create_visit_dish", {
    target_visit: input.visitId,
    dish_name: name,
    dish_kind: kind,
    dish_category: visual.category,
    dish_visual_recipe: visual,
  });
  if (legacy.error) throw legacy.error;
  return String(legacy.data);
}

export async function reorderVisitDishes(visitId: string, orderedDishIds: string[]) {
  const { error } = await requireClient().rpc("reorder_visit_dishes", {
    target_visit: visitId,
    ordered_dish_ids: orderedDishIds,
  });
  if (error) throw error;
}

export function subscribeToVisitRatingState(visitId: string, onChange: () => void) {
  const client = requireClient();
  let channel: RealtimeChannel | null = client
    .channel(`visit-rating-${visitId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "visits", filter: `id=eq.${visitId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "visit_participants", filter: `visit_id=eq.${visitId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "dishes", filter: `visit_id=eq.${visitId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "dish_public_progress" }, onChange)
    .subscribe();

  return () => {
    if (!channel) return;
    void client.removeChannel(channel);
    channel = null;
  };
}
