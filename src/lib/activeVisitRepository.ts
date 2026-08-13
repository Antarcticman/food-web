import type { RealtimeChannel } from "@supabase/supabase-js";
import { normalizeAvatarRecipe } from "./avatarRecipe";
import { getSupabaseClient } from "./supabase";
import type { AvatarRecipe, Participant } from "../types";

interface RestaurantRow {
  id: string;
  name: string;
  branch_name: string | null;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at?: string;
}

interface RestaurantAliasRow {
  restaurant_id: string;
  alias: string;
}

interface RestaurantVisitRow {
  id: string;
  restaurant_id: string;
  status: "active" | "revealed" | "closed";
  created_at: string;
  expires_at: string;
}

interface RestaurantVisitorRow {
  visit_id: string;
  user_id: string;
  profile: {
    display_name: string;
  } | {
    display_name: string;
  }[] | null;
}

interface VisitRow {
  id: string;
  status: "active" | "revealed" | "closed";
  created_at: string;
  expires_at: string;
  created_by: string;
  restaurant: RestaurantRow | RestaurantRow[] | null;
}

interface ParticipantRow {
  visit_id: string;
  user_id: string;
  joined_at: string;
  completed_at: string | null;
  excluded_at: string | null;
  profile: {
    display_name: string;
    avatar_recipe: unknown;
  } | {
    display_name: string;
    avatar_recipe: unknown;
  }[] | null;
}

interface DishCountRow {
  visit_id: string;
  is_overall: boolean;
}

export interface ActiveVisitParticipant {
  userId: string;
  joinedAt: string;
  completed: boolean;
  name: string;
  avatarRecipe: AvatarRecipe;
}

export interface ActiveVisit {
  id: string;
  status: "active" | "revealed" | "closed";
  restaurantId: string;
  restaurantName: string;
  branchName: string | null;
  address: string | null;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  dishCount: number;
  participants: ActiveVisitParticipant[];
  joined: boolean;
}

export interface CreateActiveVisitInput {
  restaurantId?: string;
  restaurantName: string;
  branchName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  locationAccuracy?: number;
  mapUrl?: string;
  saveLocation?: boolean;
  requestedAlias?: string;
  userId: string;
}

export interface NearbyRestaurant {
  id: string;
  name: string;
  branchName: string | null;
  address: string | null;
  distanceMeters: number;
}

export interface RestaurantCatalogEntry {
  id: string;
  name: string;
  branchName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  aliases: string[];
  visitCount: number;
  currentUserVisitCount: number;
  visitorNames: string[];
  latestVisitAt: string | null;
  activeVisitId: string | null;
}

export interface RestaurantSuggestion extends RestaurantCatalogEntry {
  distanceMeters: number | null;
  matchScore: number;
}

export interface RestaurantSearchLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function participantFromRow(row: ParticipantRow): ActiveVisitParticipant {
  const profile = one(row.profile);
  return {
    userId: row.user_id,
    joinedAt: row.joined_at,
    completed: Boolean(row.completed_at),
    name: profile?.display_name ?? "朋友",
    avatarRecipe: normalizeAvatarRecipe(profile?.avatar_recipe),
  };
}

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase 尚未設定");
  return client;
}

function distanceMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadius = 6_371_000;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function restaurantSearchRadius(accuracy: number) {
  return Math.min(1_000, Math.max(300, Math.round(accuracy * 2)));
}

function normalizeRestaurantText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(value: string) {
  if (value.length < 2) return value ? [value] : [];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

function textMatchScore(query: string, value: string) {
  const normalizedQuery = normalizeRestaurantText(query);
  const normalizedValue = normalizeRestaurantText(value);
  if (!normalizedQuery || !normalizedValue) return 0;
  if (normalizedQuery === normalizedValue) return 1;
  if (normalizedValue.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedValue)) return .92;
  if (normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)) return .84;
  if (normalizedQuery.length < 2) return 0;

  const queryPairs = bigrams(normalizedQuery);
  const valuePairs = bigrams(normalizedValue);
  const remaining = [...valuePairs];
  let matches = 0;
  queryPairs.forEach((pair) => {
    const index = remaining.indexOf(pair);
    if (index < 0) return;
    matches += 1;
    remaining.splice(index, 1);
  });
  return (2 * matches) / (queryPairs.length + valuePairs.length);
}

function optionalRelationUnavailable(error: { code?: string } | null) {
  return !error || error.code === "42P01" || error.code === "PGRST205";
}

export async function listRestaurantCatalog(currentUserId: string): Promise<RestaurantCatalogEntry[]> {
  const client = requireClient();
  const [{ data: restaurantData, error: restaurantError }, aliasResult, visitResult] = await Promise.all([
    client
      .from("restaurants")
      .select("id, name, branch_name, address, latitude, longitude, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1000),
    client
      .from("restaurant_aliases")
      .select("restaurant_id, alias")
      .limit(5000),
    client
      .from("visits")
      .select("id, restaurant_id, status, created_at, expires_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  if (restaurantError) throw restaurantError;
  if (aliasResult.error && !optionalRelationUnavailable(aliasResult.error)) throw aliasResult.error;
  if (visitResult.error) throw visitResult.error;

  const restaurants = (restaurantData ?? []) as RestaurantRow[];
  const aliases = aliasResult.error ? [] : (aliasResult.data ?? []) as RestaurantAliasRow[];
  const visits = (visitResult.data ?? []) as RestaurantVisitRow[];
  const visitIds = visits.map((visit) => visit.id);
  let visitors: RestaurantVisitorRow[] = [];
  if (visitIds.length) {
    const { data, error } = await client
      .from("visit_participants")
      .select(`
        visit_id,
        user_id,
        profile:profiles!visit_participants_user_id_fkey (display_name)
      `)
      .in("visit_id", visitIds)
      .is("excluded_at", null)
      .limit(10000);
    if (error) throw error;
    visitors = (data ?? []) as unknown as RestaurantVisitorRow[];
  }

  const now = Date.now();
  return restaurants.map((restaurant) => {
    const restaurantVisits = visits.filter((visit) => visit.restaurant_id === restaurant.id);
    const restaurantVisitIds = new Set(restaurantVisits.map((visit) => visit.id));
    const restaurantVisitors = visitors.filter((visitor) => restaurantVisitIds.has(visitor.visit_id));
    const visitorNames = Array.from(new Set(restaurantVisitors
      .filter((visitor) => visitor.user_id !== currentUserId)
      .map((visitor) => one(visitor.profile)?.display_name)
      .filter((name): name is string => Boolean(name))));
    const activeVisit = restaurantVisits.find((visit) => (
      visit.status === "active" && new Date(visit.expires_at).getTime() > now
    ));
    return {
      id: restaurant.id,
      name: restaurant.name,
      branchName: restaurant.branch_name,
      address: restaurant.address,
      latitude: restaurant.latitude ?? null,
      longitude: restaurant.longitude ?? null,
      aliases: aliases.filter((alias) => alias.restaurant_id === restaurant.id).map((alias) => alias.alias),
      visitCount: restaurantVisits.length,
      currentUserVisitCount: new Set(restaurantVisitors
        .filter((visitor) => visitor.user_id === currentUserId)
        .map((visitor) => visitor.visit_id)).size,
      visitorNames,
      latestVisitAt: restaurantVisits[0]?.created_at ?? null,
      activeVisitId: activeVisit?.id ?? null,
    } satisfies RestaurantCatalogEntry;
  });
}

export function suggestRestaurants(
  catalog: RestaurantCatalogEntry[],
  query: string,
  location: RestaurantSearchLocation | null,
  limit = 5,
): RestaurantSuggestion[] {
  const trimmedQuery = query.trim();
  const radius = location ? restaurantSearchRadius(location.accuracy) : null;
  const withDistance = catalog.map((restaurant) => ({
    ...restaurant,
    distanceMeters: location && restaurant.latitude != null && restaurant.longitude != null
      ? Math.round(distanceMeters(location.latitude, location.longitude, restaurant.latitude, restaurant.longitude))
      : null,
    matchScore: 0,
  }));

  if (!trimmedQuery) {
    if (location) {
      return withDistance
        .filter((restaurant) => restaurant.distanceMeters != null && restaurant.distanceMeters <= (radius ?? 300))
        .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
        .slice(0, limit);
    }
    return withDistance
      .filter((restaurant) => restaurant.latestVisitAt)
      .sort((a, b) => new Date(b.latestVisitAt ?? 0).getTime() - new Date(a.latestVisitAt ?? 0).getTime())
      .slice(0, Math.min(limit, 3));
  }

  return withDistance
    .map((restaurant) => {
      const labels = [
        restaurant.name,
        ...restaurant.aliases,
        restaurant.branchName ? `${restaurant.name}${restaurant.branchName}` : "",
      ];
      return {
        ...restaurant,
        matchScore: Math.max(...labels.map((label) => textMatchScore(trimmedQuery, label))),
      };
    })
    .filter((restaurant) => restaurant.matchScore >= .34)
    .sort((a, b) => (
      b.matchScore - a.matchScore
      || (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)
      || b.visitCount - a.visitCount
    ))
    .slice(0, limit);
}

export function isLikelyDuplicate(query: string, suggestion: RestaurantSuggestion | undefined) {
  if (!suggestion) return false;
  const exact = [suggestion.name, ...suggestion.aliases]
    .some((label) => normalizeRestaurantText(label) === normalizeRestaurantText(query));
  if (exact) return true;
  return suggestion.matchScore >= .86
    && suggestion.distanceMeters != null
    && suggestion.distanceMeters <= 500;
}

export async function findNearbyRestaurants(
  latitude: number,
  longitude: number,
  radiusMeters = 300,
): Promise<NearbyRestaurant[]> {
  const { data, error } = await requireClient()
    .from("restaurants")
    .select("id, name, branch_name, address, latitude, longitude")
    .is("deleted_at", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(1000);
  if (error) throw error;

  return ((data ?? []) as RestaurantRow[])
    .flatMap((restaurant) => {
      if (restaurant.latitude == null || restaurant.longitude == null) return [];
      const distance = distanceMeters(latitude, longitude, restaurant.latitude, restaurant.longitude);
      if (distance > radiusMeters) return [];
      return [{
        id: restaurant.id,
        name: restaurant.name,
        branchName: restaurant.branch_name,
        address: restaurant.address,
        distanceMeters: Math.round(distance),
      } satisfies NearbyRestaurant];
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);
}

export function activeVisitParticipantToAvatar(
  participant: ActiveVisitParticipant,
  currentUserId?: string,
): Participant {
  return {
    id: participant.userId,
    name: participant.name,
    color: participant.avatarRecipe.background ?? (participant.userId === currentUserId ? "#E5A28D" : "#D8CDBE"),
    avatar: participant.avatarRecipe,
  };
}

async function listVisits(
  currentUserId: string,
  statuses: Array<VisitRow["status"]>,
  limit?: number,
): Promise<ActiveVisit[]> {
  const client = requireClient();
  const now = new Date().toISOString();
  let visitQuery = client
    .from("visits")
    .select(`
      id,
      status,
      created_at,
      expires_at,
      created_by,
      restaurant:restaurants!visits_restaurant_id_fkey (
        id,
        name,
        branch_name,
        address
      )
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  visitQuery = statuses.length === 1
    ? visitQuery.eq("status", statuses[0])
    : visitQuery.in("status", statuses);
  if (statuses.length === 1 && statuses[0] === "active") visitQuery = visitQuery.gt("expires_at", now);
  if (limit) visitQuery = visitQuery.limit(limit);

  const { data: visitData, error: visitError } = await visitQuery;

  if (visitError) throw visitError;
  const visits = (visitData ?? []) as unknown as VisitRow[];
  if (!visits.length) return [];
  const visitIds = visits.map((visit) => visit.id);

  const [{ data: participantData, error: participantError }, { data: dishData, error: dishError }] = await Promise.all([
    client
      .from("visit_participants")
      .select(`
        visit_id,
        user_id,
        joined_at,
        completed_at,
        excluded_at,
        profile:profiles!visit_participants_user_id_fkey (
          display_name,
          avatar_recipe
        )
      `)
      .in("visit_id", visitIds)
      .is("excluded_at", null)
      .order("joined_at", { ascending: true }),
    client
      .from("dishes")
      .select("visit_id, is_overall")
      .in("visit_id", visitIds)
      .is("deleted_at", null),
  ]);

  if (participantError) throw participantError;
  if (dishError) throw dishError;
  const participantRows = (participantData ?? []) as unknown as ParticipantRow[];
  const dishRows = (dishData ?? []) as unknown as DishCountRow[];

  return visits.flatMap((visit) => {
    const restaurant = one(visit.restaurant);
    if (!restaurant) return [];
    const roomParticipants = participantRows
      .filter((participant) => participant.visit_id === visit.id)
      .map(participantFromRow);
    return [{
      id: visit.id,
      status: visit.status,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      branchName: restaurant.branch_name,
      address: restaurant.address,
      createdAt: visit.created_at,
      expiresAt: visit.expires_at,
      createdBy: visit.created_by,
      dishCount: dishRows.filter((dish) => dish.visit_id === visit.id && !dish.is_overall).length,
      participants: roomParticipants,
      joined: roomParticipants.some((participant) => participant.userId === currentUserId),
    } satisfies ActiveVisit];
  });
}

export function listActiveVisits(currentUserId: string): Promise<ActiveVisit[]> {
  return listVisits(currentUserId, ["active"]);
}

export async function listRecentVisits(currentUserId: string): Promise<ActiveVisit[]> {
  const visits = await listVisits(currentUserId, ["revealed", "closed"], 24);
  return visits.filter((visit) => visit.joined && visit.dishCount > 0).slice(0, 12);
}

export async function joinActiveVisit(visitId: string, userId: string) {
  const client = requireClient();
  const { data: visit, error: visitError } = await client
    .from("visits")
    .select("id, status, expires_at")
    .eq("id", visitId)
    .eq("status", "active")
    .is("deleted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<{ id: string }>();
  if (visitError) throw visitError;
  if (!visit) throw new Error("這桌已經結束或失效，請重新整理主頁。");

  const { data: existing, error: existingError } = await client
    .from("visit_participants")
    .select("visit_id, user_id, excluded_at")
    .eq("visit_id", visitId)
    .eq("user_id", userId)
    .maybeSingle<{ excluded_at: string | null }>();
  if (existingError) throw existingError;
  if (existing) {
    if (existing.excluded_at) {
      const { error } = await client
        .from("visit_participants")
        .update({ excluded_at: null })
        .eq("visit_id", visitId)
        .eq("user_id", userId);
      if (error) throw error;
    }
    return;
  }

  const { error } = await client
    .from("visit_participants")
    .insert({ visit_id: visitId, user_id: userId });
  if (error && error.code !== "23505") throw error;
}

export async function closeStaleVisit(visitId: string) {
  const { error } = await requireClient().rpc("close_stale_visit", {
    p_visit_id: visitId,
    p_reason: "管理員結束可能已離席的舊桌",
  });
  if (error) throw error;
}

export async function createActiveVisit(input: CreateActiveVisitInput): Promise<string> {
  const client = requireClient();
  const restaurantName = input.restaurantName.trim().slice(0, 160);
  const branchName = input.branchName?.trim().slice(0, 160) || null;
  const address = input.address?.trim().slice(0, 300) || null;
  if (!restaurantName && !input.restaurantId) throw new Error("請輸入餐廳名稱");

  const rpcResult = await client.rpc("create_or_join_visit", {
    p_restaurant_id: input.restaurantId ?? null,
    p_restaurant_name: restaurantName,
    p_branch_name: branchName,
    p_address: address,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_location_accuracy_m: input.locationAccuracy ?? null,
    p_map_url: input.mapUrl?.trim().slice(0, 1200) || null,
    p_save_location: input.saveLocation ?? false,
    p_requested_alias: input.requestedAlias?.trim().slice(0, 160) || null,
  });
  if (!rpcResult.error) {
    const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
    const visitId = (row as { visit_id?: string } | null)?.visit_id;
    if (!visitId) throw new Error("餐桌已建立，但沒有回傳房間資料。");
    return visitId;
  }
  const missingRpc = rpcResult.error.code === "42883" || rpcResult.error.code === "PGRST202";
  if (!missingRpc) throw rpcResult.error;

  let restaurant: { id: string; latitude?: number | null; longitude?: number | null } | null = null;
  if (input.restaurantId) {
    const { data, error } = await client
      .from("restaurants")
      .select("id")
      .eq("id", input.restaurantId)
      .is("deleted_at", null)
      .single<{ id: string }>();
    if (error) throw error;
    restaurant = data;
  }

  let existingQuery = client
    .from("restaurants")
    .select("id, latitude, longitude")
    .eq("name", restaurantName)
    .is("deleted_at", null);
  existingQuery = branchName
    ? existingQuery.eq("branch_name", branchName)
    : existingQuery.is("branch_name", null);
  if (!restaurant) {
    const { data: existingRestaurant, error: existingRestaurantError } = await existingQuery
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string; latitude: number | null; longitude: number | null }>();
    if (existingRestaurantError) throw existingRestaurantError;
    restaurant = existingRestaurant;
    if (restaurant && restaurant.latitude == null && restaurant.longitude == null
      && input.saveLocation && input.latitude !== undefined && input.longitude !== undefined) {
      const { error } = await client
        .from("restaurants")
        .update({ latitude: input.latitude, longitude: input.longitude })
        .eq("id", restaurant.id);
      if (error) throw error;
    }
  }

  if (!restaurant) {
    const { data, error } = await client
      .from("restaurants")
      .insert({
        name: restaurantName,
        branch_name: branchName,
        address,
        latitude: input.saveLocation ? input.latitude ?? null : null,
        longitude: input.saveLocation ? input.longitude ?? null : null,
        created_by: input.userId,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    restaurant = data;
  }

  const { data: activeVisit, error: activeVisitError } = await client
    .from("visits")
    .select("id")
    .eq("restaurant_id", restaurant.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (activeVisitError) throw activeVisitError;
  if (activeVisit) {
    await joinActiveVisit(activeVisit.id, input.userId);
    return activeVisit.id;
  }

  const { data: visit, error: visitError } = await client
    .from("visits")
    .insert({
      restaurant_id: restaurant.id,
      created_by: input.userId,
      expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (visitError) throw visitError;
  return visit.id;
}

export function subscribeToActiveVisits(onChange: () => void) {
  const client = requireClient();
  let channel: RealtimeChannel | null = client
    .channel("active-visits-home")
    .on("postgres_changes", { event: "*", schema: "public", table: "visits" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "visit_participants" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "dishes" }, onChange)
    .subscribe();

  return () => {
    if (!channel) return;
    void client.removeChannel(channel);
    channel = null;
  };
}
