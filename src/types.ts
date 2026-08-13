export type DishKind = "seafood" | "meat" | "dessert" | "overall";

export type DishCategory =
  | "vegetable"
  | "rice"
  | "noodle"
  | "bread_pizza"
  | "dumpling"
  | "meat"
  | "seafood"
  | "soup"
  | "drink"
  | "dessert"
  | "other";

export type DishCourseRole =
  | "appetizer"
  | "main"
  | "staple"
  | "side"
  | "soup"
  | "dessert"
  | "drink"
  | "snack"
  | "other";

export type DishIngredientFamily =
  | "meat"
  | "seafood"
  | "vegetable"
  | "egg_dairy"
  | "grain_noodle"
  | "fruit"
  | "legume"
  | "mushroom"
  | "mixed"
  | "other";

export interface NewDishInput {
  name: string;
  description: string;
  courseRole: DishCourseRole;
  ingredientFamilies: DishIngredientFamily[];
}

export type ParticipationStatus = "unopened" | "opened" | "rated" | "not_eaten";

export type DishConfirmation = "draft" | "confirmed";

export type RatingSyncState = "idle" | "saving" | "saved" | "queued" | "error";

export interface AvatarRecipe {
  head: string;
  body: string;
  glasses: string;
  item?: string;
  hair: string;
  skin: string;
  clothes: string;
  background?: string;
}

export interface DishVisualRecipe {
  category: DishCategory;
  vessel: string;
  base: string;
  topping?: string;
  sauce?: string;
  garnish?: string;
  effect?: string;
  palette: string;
  seed: number;
  assetUrl?: string;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  zIndex?: number;
}

export interface Participant {
  id: string;
  name: string;
  color: string;
  avatar: AvatarRecipe;
}

export interface Dish {
  id: string;
  order: number;
  name: string;
  description: string;
  kind: DishKind;
  category: DishCategory;
  courseRole?: DishCourseRole;
  ingredientFamilies?: DishIngredientFamily[];
  visualRecipe: DishVisualRecipe;
  confirmation: DishConfirmation;
  price?: number;
  overall?: boolean;
  previewOnly?: boolean;
  participantStatus: Record<string, ParticipationStatus>;
}

export interface RatingDraft {
  score: number | null;
  selectedReasons: string[];
  state: ParticipationStatus;
  resumeState?: Exclude<ParticipationStatus, "not_eaten">;
  openedAt?: string;
  ratedAt?: string;
  updatedAt: string;
}

export type RatingDrafts = Record<string, RatingDraft>;

export interface ResultIndividualScore {
  participantId: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface VisitDishResult {
  dish: Dish;
  restaurantDishId?: string;
  average: number;
  ratingCount: number;
  individualScores: ResultIndividualScore[];
}

export interface RankedDishResult extends VisitDishResult {
  rank: number;
}

export interface ResultRankGroup {
  rank: number;
  dishes: RankedDishResult[];
}

export interface VisitResultSnapshot {
  schemaVersion?: number;
  visitId?: string;
  version?: number;
  revealedAt?: string;
  revealIndividualScores?: boolean;
  rankingRules?: {
    minimumDishCount: number;
    minimumPodiumScore: number;
    tieRule: "average_and_rating_count";
    personWeighting: "equal_after_person_visit_average";
  };
  dishes: VisitDishResult[];
  overall: VisitDishResult | null;
}

export interface HistoricalDishResult {
  dishId: string;
  name: string;
  average: number;
  peopleCount: number;
  ratingCount: number;
}

export interface HistoricalOverallResult {
  average: number;
  peopleCount: number;
  visitCount: number;
  ratingCount: number;
}

export type SheetName = "details" | "quick-add" | null;
