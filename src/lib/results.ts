import { reasonsFor } from "../data/ratingReasons";
import type {
  Dish,
  HistoricalDishResult,
  Participant,
  RankedDishResult,
  RatingDrafts,
  ResultIndividualScore,
  ResultRankGroup,
  VisitDishResult,
  VisitResultSnapshot,
} from "../types";

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result >>> 0);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function roundAverage(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function demoScore(dish: Dish, participant: Participant, dishIndex: number, overall: boolean) {
  const base = overall ? 82 : Math.max(44, 94 - dishIndex * 7 + (hash(dish.name) % 5) - 2);
  const offset = (hash(`${dish.id}:${participant.id}`) % 13) - 6;
  return clamp(base + offset);
}

function scoreForParticipant(
  dish: Dish,
  participant: Participant,
  dishIndex: number,
  ratings: RatingDrafts,
  currentParticipantId: string,
) {
  if (dish.participantStatus[participant.id] === "not_eaten") return null;
  if (participant.id === currentParticipantId) {
    const draft = ratings[dish.id];
    if (draft?.state === "not_eaten") return null;
    if (draft?.state === "rated" && draft.score !== null) {
      return {
        score: draft.score,
        reasons: draft.selectedReasons,
      };
    }
  }
  const score = demoScore(dish, participant, dishIndex, Boolean(dish.overall));
  const choices = reasonsFor(dish, score).tags;
  const seed = hash(`${participant.id}:${dish.name}:reasons`);
  return {
    score,
    reasons: [choices[seed % choices.length]],
  };
}

function buildDishResult(
  dish: Dish,
  dishIndex: number,
  ratings: RatingDrafts,
  participants: Participant[],
  currentParticipantId: string,
): VisitDishResult {
  const individualScores = participants.flatMap<ResultIndividualScore>((participant) => {
    const result = scoreForParticipant(dish, participant, dishIndex, ratings, currentParticipantId);
    if (!result) return [];
    return [{
      participantId: participant.id,
      name: participant.name,
      score: result.score,
      reasons: result.reasons,
      note: participant.id === currentParticipantId ? ratings[dish.id]?.note : undefined,
    }];
  });
  return {
    dish,
    average: roundAverage(individualScores.map((item) => item.score)),
    ratingCount: individualScores.length,
    individualScores,
  };
}

export function buildDemoResultSnapshot(
  dishes: Dish[],
  ratings: RatingDrafts,
  participants: Participant[],
  currentParticipantId: string,
): VisitResultSnapshot {
  const regular = dishes.filter((dish) => !dish.overall && !dish.previewOnly && dish.confirmation === "confirmed");
  const overallDish = dishes.find((dish) => dish.overall && dish.confirmation === "confirmed") ?? null;
  return {
    dishes: regular.map((dish, index) => buildDishResult(dish, index, ratings, participants, currentParticipantId)),
    overall: overallDish
      ? buildDishResult(overallDish, regular.length, ratings, participants, currentParticipantId)
      : null,
  };
}

export function rankVisitDishes(dishes: VisitDishResult[]) {
  const sorted = [...dishes]
    .filter((dish) => dish.ratingCount > 0)
    .sort((a, b) => b.average - a.average || b.ratingCount - a.ratingCount || a.dish.order - b.dish.order);
  const ranked: RankedDishResult[] = [];
  let previousAverage: number | null = null;
  let previousCount: number | null = null;
  let previousRank = 0;
  sorted.forEach((dish, index) => {
    const tied = dish.average === previousAverage && dish.ratingCount === previousCount;
    const rank = tied ? previousRank : index + 1;
    ranked.push({ ...dish, rank });
    previousAverage = dish.average;
    previousCount = dish.ratingCount;
    previousRank = rank;
  });
  return ranked;
}

export function podiumGroups(ranked: RankedDishResult[]): ResultRankGroup[] {
  const byRank = new Map<number, RankedDishResult[]>();
  ranked.forEach((dish) => {
    if (dish.rank > 3 || dish.average < 60) return;
    byRank.set(dish.rank, [...(byRank.get(dish.rank) ?? []), dish]);
  });
  return [...byRank.entries()].map(([rank, dishes]) => ({ rank, dishes }));
}

export function buildDemoHistoryLeaderboard(
  currentResults: VisitDishResult[],
  participants: Participant[],
): HistoricalDishResult[] {
  return currentResults.map((result, dishIndex) => {
    const personalAverages = participants.flatMap((participant, participantIndex) => {
      const current = result.individualScores.find((score) => score.participantId === participant.id)?.score;
      if (current === undefined) return [];
      const previousVisitCount = 1 + (hash(`${result.dish.id}:${participant.id}:visits`) % 3);
      const visits = [current];
      for (let visitIndex = 0; visitIndex < previousVisitCount; visitIndex += 1) {
        const drift = (hash(`${result.dish.id}:${participant.id}:${visitIndex}`) % 15) - 7;
        visits.push(clamp(current + drift - dishIndex + participantIndex % 2));
      }
      return [{ average: roundAverage(visits), count: visits.length }];
    });
    return {
      dishId: result.dish.id,
      name: result.dish.name,
      average: roundAverage(personalAverages.map((item) => item.average)),
      peopleCount: personalAverages.length,
      ratingCount: personalAverages.reduce((sum, item) => sum + item.count, 0),
    };
  }).sort((a, b) => b.average - a.average || b.peopleCount - a.peopleCount || a.name.localeCompare(b.name, "zh-TW"));
}
