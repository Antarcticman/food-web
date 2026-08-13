import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { Avatar } from "./components/Avatar";
import { useAuth } from "./components/AuthGate";
import { DishRail } from "./components/DishRail";
import { HomePage } from "./components/HomePage";
import { ProfileEditorSheet } from "./components/ProfileEditorSheet";
import { QuickAddSheet } from "./components/QuickAddSheet";
import { RatingStage } from "./components/RatingStage";
import { ResultsGate, ResultsReveal } from "./components/ResultsReveal";
import { TableDetailsSheet, type DishEditInput } from "./components/TableDetailsSheet";
import {
  initialDishes as demoDishes,
  initialRatings as demoRatings,
  participants as demoParticipants,
} from "./data/demo";
import { reasonsFor } from "./data/ratingReasons";
import { loadResultSnapshot, markResultViewed, revealVisit, setVisitReady, type PersistedResultSnapshot } from "./lib/resultRepository";
import { buildDemoResultSnapshot } from "./lib/results";
import type { ActiveVisit } from "./lib/activeVisitRepository";
import {
  confirmVisitDish,
  createVisitDish,
  deleteVisitDish,
  loadVisitRatingState,
  openVisitDish,
  reorderVisitDishes,
  restoreVisitDish,
  saveVisitRating,
  saveVisitRatingNote,
  setVisitDishConsumers,
  setVisitDishConsumption,
  subscribeToVisitRatingState,
  updateVisitDishClassification,
  updateVisitDishDetails,
  type VisitRoomParticipant,
} from "./lib/visitRatingRepository";
import type {
  Dish,
  DishCategory,
  DishConfirmation,
  DishKind,
  DishVisualRecipe,
  NewDishInput,
  ParticipationStatus,
  RatingDraft,
  RatingDrafts,
  RatingSyncState,
  SheetName,
  VisitResultSnapshot,
} from "./types";

interface ToastState {
  message: string;
  undo?: () => void;
}

type DishTransitionDirection = -1 | 0 | 1;
type AppScreen = "rating" | "results-gate" | "results";
type ResultPresentation = "fresh" | "complete";

interface RatingExperienceProps {
  activeVisit: ActiveVisit;
  onHome: () => void;
}

function draftFor(dish: Dish, currentParticipantId: string): RatingDraft {
  const state = dish.participantStatus[currentParticipantId] ?? "unopened";
  return {
    score: null,
    selectedReasons: [],
    note: "",
    state,
    updatedAt: new Date().toISOString(),
  };
}

function resultDishFromSnapshot(
  item: PersistedResultSnapshot["dishes"][number],
  fallback?: Dish,
): VisitResultSnapshot["dishes"][number] {
  const category = item.category as DishCategory;
  const visualRecipe = item.visualRecipe as DishVisualRecipe;
  const kind: DishKind = item.isOverall
    ? "overall"
    : item.kind === "dessert" || category === "dessert"
      ? "dessert"
      : item.kind === "meat" || category === "meat"
        ? "meat"
        : "seafood";
  const dish: Dish = fallback ?? {
    id: item.dishId,
    order: item.isOverall ? 999 : 0,
    name: item.name,
    description: "",
    kind,
    category,
    visualRecipe,
    confirmation: "confirmed" as DishConfirmation,
    overall: item.isOverall,
    participantStatus: {},
  };
  return {
    dish,
    restaurantDishId: item.restaurantDishId,
    average: item.average ?? 0,
    ratingCount: item.ratingCount,
    individualScores: (item.individualScores ?? []).map((score) => ({
      participantId: score.userId,
      name: score.name,
      score: score.score,
      reasons: score.reasons,
      note: score.note,
    })),
  };
}

function resultSnapshotFromPersisted(snapshot: PersistedResultSnapshot, dishes: Dish[]): VisitResultSnapshot {
  const mapped = snapshot.dishes.map((item) => resultDishFromSnapshot(
    item,
    dishes.find((dish) => dish.id === item.dishId),
  ));
  return {
    schemaVersion: snapshot.schemaVersion,
    visitId: snapshot.visitId,
    version: snapshot.version,
    revealedAt: snapshot.revealedAt,
    revealIndividualScores: snapshot.revealIndividualScores,
    rankingRules: snapshot.rankingRules,
    dishes: mapped.filter((item) => !item.dish.overall),
    overall: mapped.find((item) => item.dish.overall) ?? null,
  };
}

function isFinished(status: ParticipationStatus | undefined) {
  return status === "rated" || status === "not_eaten";
}

function RatingExperience({ activeVisit, onHome }: RatingExperienceProps) {
  const { profile } = useAuth();
  const currentParticipantId = profile.id;
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [ratings, setRatings] = useState<RatingDrafts>({});
  const [roomParticipants, setRoomParticipants] = useState<VisitRoomParticipant[]>([]);
  const [activeDishId, setActiveDishId] = useState("");
  const [ready, setReady] = useState(false);
  const [readyPending, setReadyPending] = useState(false);
  const [everyoneReady, setEveryoneReady] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [roomError, setRoomError] = useState("");
  const [resultViewed, setResultViewed] = useState(false);
  const [screen, setScreen] = useState<AppScreen>("rating");
  const [resultPresentation, setResultPresentation] = useState<ResultPresentation>("fresh");
  const [persistedResult, setPersistedResult] = useState<VisitResultSnapshot | null>(null);
  const [resultDemo, setResultDemo] = useState(false);
  const [resultReplayKey, setResultReplayKey] = useState(0);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [syncState, setSyncState] = useState<RatingSyncState>("idle");
  const [dishTransitionDirection, setDishTransitionDirection] = useState<DishTransitionDirection>(0);
  const toastTimer = useRef<number | null>(null);
  const syncTimer = useRef<number | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const writeChains = useRef(new Map<string, Promise<void>>());
  const noteTimers = useRef(new Map<string, number>());
  const latestNotes = useRef(new Map<string, string>());
  const profilePrompted = useRef(false);
  const displayParticipants = useMemo(
    () => roomParticipants.map((participant) => participant.id === currentParticipantId
      ? {
        ...participant,
        name: profile.displayName,
        color: profile.avatarRecipe.background ?? participant.color,
        avatar: profile.avatarRecipe,
      }
      : participant),
    [currentParticipantId, profile.avatarRecipe, profile.displayName, roomParticipants],
  );
  const currentParticipant = displayParticipants.find((participant) => participant.id === currentParticipantId) ?? {
    id: currentParticipantId,
    name: profile.displayName,
    color: profile.avatarRecipe.background ?? "#E5A28D",
    avatar: profile.avatarRecipe,
  };
  const ratingDishes = dishes.filter((dish) => dish.previewOnly || dish.overall || currentParticipantId in dish.participantStatus);
  const activeDish = ratingDishes.find((dish) => dish.id === activeDishId) ?? ratingDishes[0];
  const activeDraft = activeDish
    ? ratings[activeDish.id] ?? draftFor(activeDish, currentParticipantId)
    : null;
  const roomRegularDishes = dishes.filter((dish) => !dish.overall && !dish.previewOnly);
  const regularDishes = ratingDishes.filter((dish) => !dish.overall && !dish.previewOnly);
  const regularIndex = activeDish ? regularDishes.findIndex((dish) => dish.id === activeDish.id) : -1;
  const emptyMenu = regularDishes.length === 0;
  const remaining = regularDishes.filter(
    (dish) => !isFinished(dish.participantStatus[currentParticipantId]),
  );
  const overallLocked = Boolean(activeDish?.overall && (emptyMenu || remaining.length > 0));
  const demoResultSnapshot = useMemo(
    () => buildDemoResultSnapshot(demoDishes, demoRatings, demoParticipants, demoParticipants[0].id),
    [],
  );

  const applyRoomState = useCallback((state: Awaited<ReturnType<typeof loadVisitRatingState>>) => {
    const mergedDishes = state.dishes;
    setDishes(mergedDishes);
    setRatings(state.ratings);
    setRoomParticipants(state.participants);
    setReady(state.ready);
    setEveryoneReady(state.everyoneReady);
    const availableDishes = mergedDishes.filter((dish) => dish.previewOnly || dish.overall || currentParticipantId in dish.participantStatus);
    setActiveDishId((current) => availableDishes.some((dish) => dish.id === current)
      ? current
      : availableDishes.find((dish) => !dish.previewOnly)?.id ?? availableDishes[0]?.id ?? "");
  }, [currentParticipantId]);

  const refreshRoom = useCallback(async (showLoading = false) => {
    if (showLoading) setLoadingRoom(true);
    try {
      const state = await loadVisitRatingState(activeVisit.id, currentParticipantId);
      applyRoomState(state);
      if (showLoading && state.visitStatus !== "active") {
        const snapshot = await loadResultSnapshot(activeVisit.id, state.resultVersion || undefined);
        if (snapshot) {
          setPersistedResult(resultSnapshotFromPersisted(snapshot, state.dishes));
          setResultDemo(false);
          setResultPresentation("complete");
          setScreen("results");
        } else {
          setScreen("results-gate");
        }
      } else if (showLoading && state.ready) {
        setScreen("results-gate");
      }
      setRoomError("");
    } catch (error) {
      if (showLoading) setRoomError(error instanceof Error ? error.message : "無法讀取這桌資料，請稍後再試。");
    } finally {
      if (showLoading) setLoadingRoom(false);
    }
  }, [activeVisit.id, applyRoomState, currentParticipantId]);

  useEffect(() => {
    void refreshRoom(true);
    const scheduleRefresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void refreshRoom(), 180);
    };
    const unsubscribe = subscribeToVisitRatingState(activeVisit.id, scheduleRefresh);
    const polling = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRoom();
    }, 5000);
    return () => {
      unsubscribe();
      window.clearInterval(polling);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [activeVisit.id, refreshRoom]);

  useEffect(() => {
    const onOnline = () => {
      setSyncState("saved");
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => setSyncState("idle"), 1200);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    noteTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (profile.avatarConfigured || profilePrompted.current) return;
    profilePrompted.current = true;
    setProfileOpen(true);
  }, [profile.avatarConfigured]);

  const showToast = useCallback((message: string, undo?: () => void) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), undo ? 5200 : 3400);
  }, []);

  const queueWrite = useCallback((key: string, task: () => Promise<void>, refreshOnError = true) => {
    const previous = writeChains.current.get(key) ?? Promise.resolve();
    setSyncState(window.navigator.onLine ? "saving" : "queued");
    const next = previous
      .catch(() => undefined)
      .then(task)
      .then(() => {
        setSyncState("saved");
        if (syncTimer.current) window.clearTimeout(syncTimer.current);
        syncTimer.current = window.setTimeout(() => setSyncState("idle"), 1100);
      })
      .catch((error) => {
        setSyncState("error");
        showToast(error instanceof Error ? error.message : "儲存失敗，已重新讀取這桌資料。");
        if (refreshOnError) void refreshRoom();
      })
      .finally(() => {
        if (writeChains.current.get(key) === next) writeChains.current.delete(key);
      });
    writeChains.current.set(key, next);
  }, [refreshRoom, showToast]);

  const cancelReady = () => {
    if (ready) {
      setReady(false);
      setEveryoneReady(false);
      setRoomParticipants((current) => current.map((participant) => participant.id === currentParticipantId
        ? { ...participant, ready: false }
        : participant));
      setResultViewed(false);
      setScreen("rating");
    }
  };

  const selectDish = (dishId: string) => {
    if (!activeDish) return;
    const currentIndex = ratingDishes.findIndex((dish) => dish.id === activeDish.id);
    const targetIndex = ratingDishes.findIndex((dish) => dish.id === dishId);
    if (targetIndex < 0 || targetIndex === currentIndex) return;
    setDishTransitionDirection(targetIndex > currentIndex ? 1 : -1);
    setActiveDishId(dishId);
  };

  const navigateDish = (direction: -1 | 1) => {
    if (!activeDish) return;
    const index = ratingDishes.findIndex((dish) => dish.id === activeDish.id);
    const target = ratingDishes[index + direction];
    if (target) selectDish(target.id);
  };

  const openDish = () => {
    if (!activeDish || !activeDraft || activeDish.overall || activeDish.previewOnly || activeDraft.state !== "unopened") return;
    const now = new Date().toISOString();
    setDishes((current) => current.map((dish) => dish.id === activeDish.id
      ? { ...dish, participantStatus: { ...dish.participantStatus, [currentParticipantId]: "opened" } }
      : dish));
    setRatings((current) => ({
      ...current,
      [activeDish.id]: { ...activeDraft, state: "opened", openedAt: now, updatedAt: now },
    }));
    cancelReady();
    queueWrite(activeDish.id, () => openVisitDish(activeDish.id, currentParticipantId));
  };

  const commitScore = (score: number) => {
    if (!activeDish || !activeDraft || activeDish.previewOnly) return;
    const now = new Date().toISOString();
    const validReasons = reasonsFor(activeDish, score).tags;
    const selectedReasons = activeDraft.selectedReasons.filter((reason) => validReasons.includes(reason));
    setRatings((current) => {
      const draft = current[activeDish.id] ?? activeDraft;
      return {
        ...current,
        [activeDish.id]: {
          ...draft,
          score,
          state: "rated",
          selectedReasons,
          openedAt: draft.openedAt ?? now,
          ratedAt: draft.ratedAt ?? now,
          updatedAt: now,
        },
      };
    });
    setDishes((current) => current.map((dish) => dish.id === activeDish.id
      ? { ...dish, participantStatus: { ...dish.participantStatus, [currentParticipantId]: "rated" } }
      : dish));
    cancelReady();
    queueWrite(activeDish.id, () => saveVisitRating(activeDish.id, currentParticipantId, score, selectedReasons));
  };

  const toggleReason = (reason: string) => {
    if (!activeDish || !activeDraft || activeDish.previewOnly || activeDraft.state !== "rated" || activeDraft.score === null) return;
    const now = new Date().toISOString();
    const selected = activeDraft.selectedReasons.includes(reason);
    if (!selected && activeDraft.selectedReasons.length >= 3) {
      showToast("最多選 3 個詞條；先取消一個再選新的。");
      return;
    }
    const selectedReasons = selected
      ? activeDraft.selectedReasons.filter((item) => item !== reason)
      : [...activeDraft.selectedReasons, reason];
    setRatings((current) => {
      const draft = current[activeDish.id] ?? activeDraft;
      return { ...current, [activeDish.id]: { ...draft, selectedReasons, updatedAt: now } };
    });
    cancelReady();
    queueWrite(activeDish.id, () => saveVisitRating(activeDish.id, currentParticipantId, activeDraft.score as number, selectedReasons));
  };

  const changeNote = (note: string) => {
    if (!activeDish || !activeDraft || activeDish.previewOnly || activeDraft.state !== "rated") return;
    const dishId = activeDish.id;
    const cleaned = note.slice(0, 300);
    latestNotes.current.set(dishId, cleaned);
    setRatings((current) => ({
      ...current,
      [dishId]: { ...(current[dishId] ?? activeDraft), note: cleaned, updatedAt: new Date().toISOString() },
    }));
    cancelReady();
    const prior = noteTimers.current.get(dishId);
    if (prior) window.clearTimeout(prior);
    noteTimers.current.set(dishId, window.setTimeout(() => {
      noteTimers.current.delete(dishId);
      queueWrite(`note:${dishId}`, () => saveVisitRatingNote(dishId, currentParticipantId, cleaned), false);
    }, 700));
  };

  const flushNote = () => {
    if (!activeDish || !activeDraft || activeDish.previewOnly || activeDraft.state !== "rated") return;
    const dishId = activeDish.id;
    const timer = noteTimers.current.get(dishId);
    if (timer) window.clearTimeout(timer);
    noteTimers.current.delete(dishId);
    const latest = latestNotes.current.get(dishId) ?? activeDraft.note;
    queueWrite(`note:${dishId}`, () => saveVisitRatingNote(dishId, currentParticipantId, latest), false);
  };

  const confirmDish = () => {
    if (!activeDish) return;
    // The draft and confirmed views share the same physical cloche position.
    // Clear any prior course direction so confirmation never replays a slide-in.
    setDishTransitionDirection(0);
    setDishes((current) => current.map((dish) => dish.id === activeDish.id ? { ...dish, confirmation: "confirmed" } : dish));
    queueWrite(activeDish.id, () => confirmVisitDish(activeDish.id, currentParticipantId));
    showToast(`「${activeDish.name}」已確認，點鐵罩開始`);
  };
  const toggleNotEaten = () => {
    if (!activeDish || !activeDraft || activeDish.overall || activeDish.previewOnly) return;
    const now = new Date().toISOString();
    const currentState = activeDraft.state;
    const nextState: ParticipationStatus = currentState === "not_eaten"
      ? activeDraft.resumeState ?? (activeDraft.score !== null ? "rated" : "opened")
      : "not_eaten";
    setRatings((current) => ({
      ...current,
      [activeDish.id]: {
        ...activeDraft,
        state: nextState,
        resumeState: currentState === "not_eaten" ? activeDraft.resumeState : currentState,
        updatedAt: now,
      },
    }));
    setDishes((current) => current.map((dish) => dish.id === activeDish.id
      ? { ...dish, participantStatus: { ...dish.participantStatus, [currentParticipantId]: nextState } }
      : dish));
    cancelReady();
    queueWrite(activeDish.id, () => setVisitDishConsumption(
      activeDish.id,
      currentParticipantId,
      nextState,
      currentState === "not_eaten" ? activeDraft.resumeState : currentState,
    ));
  };

  const toggleReady = async () => {
    if (
      readyPending
      || !activeDish
      || !activeDraft
      || !activeDish.overall
      || activeDraft.state !== "rated"
      || emptyMenu
      || remaining.length > 0
    ) return;
    const next = !ready;
    setReadyPending(true);
    setSyncState(window.navigator.onLine ? "saving" : "queued");
    try {
      const allReady = await setVisitReady(activeVisit.id, next);
      setReady(next);
      setRoomParticipants((current) => current.map((participant) => participant.id === currentParticipantId
        ? { ...participant, ready: next }
        : participant));
      setEveryoneReady(allReady);
      setSyncState("saved");
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => setSyncState("idle"), 1200);

      if (next) {
        setResultPresentation("fresh");
        setResultDemo(false);
        setScreen("results-gate");
        showToast(allReady ? "評分完成，大家都準備好揭曉了！" : "評分完成，正在等其他人。");
      } else {
        setEveryoneReady(false);
        setResultViewed(false);
        setScreen("rating");
        showToast("已取消完成狀態，可以繼續修改評分。");
      }
      await refreshRoom();
    } catch (error) {
      setSyncState("error");
      showToast(error instanceof Error
        ? `還不能完成評分：${error.message}`
        : "還不能完成評分，請再試一次。");
      await refreshRoom();
    } finally {
      setReadyPending(false);
    }
  };

  const openResultPreview = () => {
    setResultDemo(true);
    setResultPresentation("fresh");
    setResultReplayKey((current) => current + 1);
    setScreen("results");
  };

  const beginResultReveal = async () => {
    if (!everyoneReady) return;
    setSyncState("saving");
    try {
      const version = await revealVisit(activeVisit.id);
      const snapshot = await loadResultSnapshot(activeVisit.id, version);
      if (!snapshot) throw new Error("結算資料尚未產生，請再試一次。");
      setPersistedResult(resultSnapshotFromPersisted(snapshot, dishes));
      setResultDemo(false);
      setResultPresentation("fresh");
      setResultReplayKey((current) => current + 1);
      setScreen("results");
      setSyncState("saved");
    } catch (error) {
      setSyncState("error");
      showToast(error instanceof Error ? error.message : "目前無法揭曉結果。");
    }
  };

  const replayResults = () => {
    setResultPresentation("fresh");
    setResultReplayKey((current) => current + 1);
  };

  const finishResultPreview = () => {
    setResultDemo(false);
    setScreen("rating");
  };

  const reorderDish = (dishId: string, targetId: string) => {
    let orderedIds: string[] = [];
    setDishes((current) => {
      const regular = current.filter((dish) => !dish.overall && !dish.previewOnly);
      const preview = current.filter((dish) => dish.previewOnly);
      const overall = current.filter((dish) => dish.overall);
      const from = regular.findIndex((dish) => dish.id === dishId);
      const to = regular.findIndex((dish) => dish.id === targetId);
      if (from < 0 || to < 0) return current;
      const reordered = [...regular];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      orderedIds = reordered.map((dish) => dish.id);
      return [...reordered.map((dish, index) => ({ ...dish, order: index + 1 })), ...preview, ...overall];
    });
    cancelReady();
    window.setTimeout(() => {
      if (orderedIds.length) queueWrite(`order:${activeVisit.id}`, () => reorderVisitDishes(activeVisit.id, orderedIds));
    }, 0);
  };

  const moveDish = (dishId: string, direction: -1 | 1) => {
    const index = roomRegularDishes.findIndex((dish) => dish.id === dishId);
    const target = roomRegularDishes[index + direction];
    if (target) reorderDish(dishId, target.id);
  };

  const updateDish = (dishId: string, input: DishEditInput) => {
    const target = dishes.find((dish) => dish.id === dishId);
    if (!target || target.overall || target.previewOnly) return;
    const name = input.name.trim().slice(0, 180);
    const description = input.description.trim().slice(0, 400);
    const participantIds = [...new Set(input.participantIds)];
    const nameChanged = name !== target.name;
    const participantStatus = Object.fromEntries(participantIds.map((participantId) => [
      participantId,
      target.participantStatus[participantId] ?? "unopened",
    ])) as Record<string, ParticipationStatus>;

    cancelReady();
    setDishes((current) => current.map((dish) => dish.id === dishId
      ? {
        ...dish,
        name,
        description,
        confirmation: nameChanged ? "draft" : dish.confirmation,
        courseRole: input.courseRole,
        ingredientFamilies: input.ingredientFamilies,
        participantStatus,
      }
      : dish));

    queueWrite(`edit:${dishId}`, async () => {
      await updateVisitDishDetails(dishId, name, description);
      const updated = await updateVisitDishClassification(
        { ...target, name, description },
        input.courseRole,
        input.ingredientFamilies,
      );
      await setVisitDishConsumers(dishId, participantIds);
      setDishes((current) => current.map((dish) => dish.id === dishId
        ? { ...dish, category: updated.category, visualRecipe: updated.visualRecipe }
        : dish));
      await refreshRoom();
    });
    showToast(`「${name}」已更新`);
  };

  const removeDish = (dishId: string) => {
    const target = dishes.find((dish) => dish.id === dishId);
    if (!target || target.overall || target.previewOnly) return;
    cancelReady();
    setDishes((current) => current.filter((dish) => dish.id !== dishId));
    queueWrite(`delete:${dishId}`, () => deleteVisitDish(dishId));
    showToast(`已移除「${target.name}」`, () => {
      queueWrite(`delete:${dishId}`, async () => {
        await restoreVisitDish(dishId);
        await refreshRoom();
      });
    });
  };

  const addDish = (dish: NewDishInput) => {
    cancelReady();
    queueWrite(`add:${activeVisit.id}`, async () => {
      const id = await createVisitDish({ visitId: activeVisit.id, userId: currentParticipantId, ...dish });
      const state = await loadVisitRatingState(activeVisit.id, currentParticipantId);
      applyRoomState(state);
      setDishTransitionDirection(1);
      setActiveDishId(id);
    });
  };

  if (loadingRoom || roomError || !activeDish || !activeDraft) {
    return (
      <div className="app-shell app-shell--rating-focus">
        <header className="topbar focus-topbar">
          <button className="icon-button back-button" type="button" aria-label="回到首頁" onClick={onHome}>
            <ArrowLeft weight="bold" />
          </button>
          <div className="focus-title"><strong>{activeVisit.restaurantName}</strong><small>TABLE</small></div>
          <span className="profile-button is-placeholder" aria-hidden="true" />
        </header>
        <main id="main" className="room-state-main" tabIndex={-1}>
          <section className="room-state-card" aria-live="polite">
            {loadingRoom ? (
              <><span className="room-state-loader" aria-hidden="true" /><strong>正在把這桌端上來</strong><p>同步菜單、朋友與你的評分紀錄…</p></>
            ) : (
              <><strong>這桌目前讀不到</strong><p>{roomError || "房間裡還沒有可用的餐點資料。"}</p><button type="button" onClick={() => void refreshRoom(true)}>再試一次</button></>
            )}
          </section>
        </main>
      </div>
    );
  }

  const courseLabel = screen === "results"
    ? resultDemo ? "DEMO" : "RESULTS"
    : screen === "results-gate"
      ? "READY"
      : activeDish.previewOnly
        ? "DEMO"
        : activeDish.overall
          ? "TOTAL"
          : `${Math.max(regularIndex + 1, 1)}/${regularDishes.length}`;
  const focusAriaLabel = screen === "results"
    ? `${activeVisit.restaurantName}，本次結果`
    : screen === "results-gate"
      ? `${activeVisit.restaurantName}，結果已準備`
      : activeDish.previewOnly
        ? `${activeVisit.restaurantName}，場景預覽`
        : activeDish.overall
          ? `${activeVisit.restaurantName}，整體用餐`
          : `${activeVisit.restaurantName}，第 ${courseLabel} 道`;

  const handleTopbarBack = () => {
    if (screen === "results-gate") {
      setScreen("rating");
      return;
    }
    if (screen === "results" && resultDemo) {
      finishResultPreview();
      return;
    }
    onHome();
  };

  return (
    <>
      <a className="skip-link" href="#main">跳到評分內容</a>
      <div className={`app-shell ${screen === "rating" ? "app-shell--rating-focus" : "app-shell--results"}`}>
        <header className="topbar focus-topbar">
          <button className="icon-button back-button" type="button" aria-label={screen === "results-gate" || resultDemo ? "返回評分" : "返回餐廳"} onClick={handleTopbarBack}>
            <ArrowLeft weight="bold" />
          </button>
          <div className="focus-title" aria-label={focusAriaLabel}>
            <strong>{activeVisit.restaurantName}</strong>
            <small>{courseLabel}</small>
          </div>
          <button className="profile-button" type="button" aria-label={`開啟 ${profile.displayName} 的個人資料`} onClick={() => setProfileOpen(true)}>
            <Avatar participant={currentParticipant} variant="profile" decorative />
            <i aria-hidden="true" />
          </button>
        </header>

        {screen === "rating" ? (
          <main id="main" tabIndex={-1}>
            <DishRail
              dishes={ratingDishes}
              activeId={activeDish.id}
              currentParticipantId={currentParticipantId}
              remainingCount={remaining.length}
              onSelect={selectDish}
              onOpenDetails={() => setSheet("details")}
              onOpenAdd={() => setSheet("quick-add")}
            />

            <RatingStage
              dish={activeDish}
              participant={currentParticipant}
              participants={displayParticipants}
              currentParticipantId={currentParticipantId}
              draft={activeDraft}
              locked={overallLocked}
              emptyMenu={emptyMenu}
              remainingCount={remaining.length}
              ready={ready}
              readyPending={readyPending}
              syncState={syncState}
              transitionDirection={dishTransitionDirection}
              onOpen={openDish}
              onScoreCommit={commitScore}
              onToggleReason={toggleReason}
              onNoteChange={changeNote}
              onNoteBlur={flushNote}
              onConfirm={confirmDish}
              onToggleNotEaten={toggleNotEaten}
              onNavigate={navigateDish}
              onToggleReady={() => void toggleReady()}
              onGoToUnfinished={() => {
                if (emptyMenu) setSheet("quick-add");
                else if (remaining[0]) selectDish(remaining[0].id);
              }}
              onOpenResultPreview={openResultPreview}
            />
          </main>
        ) : screen === "results-gate" ? (
          <ResultsGate
            participants={displayParticipants}
            readyParticipantIds={new Set(roomParticipants.filter((participant) => participant.ready).map((participant) => participant.id))}
            canReveal={everyoneReady}
            onReveal={() => void beginResultReveal()}
            onBack={() => setScreen("rating")}
          />
        ) : (
          <ResultsReveal
            key={`${resultPresentation}-${resultReplayKey}`}
            snapshot={resultDemo ? demoResultSnapshot : persistedResult ?? demoResultSnapshot}
            participants={resultDemo ? demoParticipants : displayParticipants}
            restaurantId={resultDemo ? undefined : activeVisit.restaurantId}
            historical={!resultDemo && activeVisit.status !== "active"}
            initiallyComplete={resultPresentation === "complete"}
            demo={resultDemo}
            onViewed={() => {
              if (resultDemo || !persistedResult?.version) return;
              setResultViewed(true);
              queueWrite(`view:${activeVisit.id}`, () => markResultViewed(activeVisit.id, persistedResult.version as number).then(() => undefined));
            }}
            onReplay={replayResults}
            onBack={finishResultPreview}
            onHome={onHome}
          />
        )}
      </div>

      <TableDetailsSheet
        open={sheet === "details"}
        dishes={dishes.filter((dish) => !dish.previewOnly)}
        participants={displayParticipants}
        currentParticipantId={currentParticipantId}
        onClose={() => setSheet(null)}
        onSelect={selectDish}
        onReorder={reorderDish}
        onMove={moveDish}
        isAdmin={profile.isAdmin}
        onUpdateDish={updateDish}
        onDeleteDish={removeDish}
        onNotify={showToast}
      />
      <QuickAddSheet open={sheet === "quick-add"} onClose={() => setSheet(null)} onAdd={addDish} />
      <ProfileEditorSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSaved={() => showToast("角色已更新，朋友也會看到新的你")}
      />

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.undo && <button type="button" onClick={toast.undo}>復原</button>}
        </div>
      )}
    </>
  );
}

const activeVisitSessionKey = "tastelog.active-visit.v1";

function loadActiveVisitSession(): ActiveVisit | null {
  try {
    const value = window.sessionStorage.getItem(activeVisitSessionKey);
    return value ? JSON.parse(value) as ActiveVisit : null;
  } catch {
    return null;
  }
}

function App() {
  const [activeVisit, setActiveVisit] = useState<ActiveVisit | null>(() => loadActiveVisitSession());

  const openVisit = (visit: ActiveVisit) => {
    window.sessionStorage.setItem(activeVisitSessionKey, JSON.stringify(visit));
    setActiveVisit(visit);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const goHome = () => {
    window.sessionStorage.removeItem(activeVisitSessionKey);
    setActiveVisit(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return activeVisit
    ? <RatingExperience activeVisit={activeVisit} onHome={goHome} />
    : <HomePage onOpenVisit={openVisit} />;
}

export default App;
