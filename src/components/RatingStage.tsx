import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Check, CircleNotch, LockSimple, NotePencil } from "@phosphor-icons/react";
import { Avatar } from "./Avatar";
import { DishVisual } from "./DishVisual";
import { ParticipantStrip } from "./ParticipantStrip";
import { SceneDomeArtwork, ScenePlateArtwork, SceneTableArtwork } from "./SceneArtwork";
import { categoryLabels } from "../data/dishVisuals";
import { reasonsFor, scoreLabel } from "../data/ratingReasons";
import type { Dish, Participant, RatingDraft, RatingSyncState } from "../types";

interface RatingStageProps {
  dish: Dish;
  participant: Participant;
  participants: Participant[];
  currentParticipantId: string;
  draft: RatingDraft;
  locked?: boolean;
  emptyMenu?: boolean;
  remainingCount?: number;
  ready: boolean;
  readyPending?: boolean;
  syncState: RatingSyncState;
  transitionDirection?: -1 | 0 | 1;
  transitionRevision?: number;
  onOpen: () => void;
  onScoreCommit: (score: number) => void;
  onToggleReason: (reason: string) => void;
  onNoteChange: (note: string) => void;
  onNoteBlur: () => void;
  onConfirm: () => void;
  onToggleNotEaten: () => void;
  onNavigate: (direction: -1 | 1) => void;
  onToggleReady: () => void;
  onGoToUnfinished?: () => void;
  onOpenResultPreview?: () => void;
}

type GestureMode = "idle" | "pending" | "vertical-rating" | "horizontal-dish";

interface PointerSession {
  pointerId: number;
  startX: number;
  startY: number;
  startScore: number;
  mode: GestureMode;
  startedOnCloche: boolean;
  startedOnPreviewDish: boolean;
}

const directionThreshold = 12;
const switchThreshold = 52;
const pixelsPerPoint = 1.7;
const sceneRulerMarks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function syncLabel(state: RatingSyncState) {
  if (state === "saving") return "儲存中…";
  if (state === "saved") return "已更新";
  if (state === "queued") return "待連線同步";
  if (state === "error") return "同步失敗 · 重試";
  return "";
}

export function RatingStage({
  dish,
  participant,
  participants,
  currentParticipantId,
  draft,
  locked = false,
  emptyMenu = false,
  remainingCount = 0,
  ready,
  readyPending = false,
  syncState,
  transitionDirection = 0,
  transitionRevision = 0,
  onOpen,
  onScoreCommit,
  onToggleReason,
  onNoteChange,
  onNoteBlur,
  onConfirm,
  onToggleNotEaten,
  onNavigate,
  onToggleReady,
  onGoToUnfinished,
  onOpenResultPreview,
}: RatingStageProps) {
  const sessionRef = useRef<PointerSession | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const reboundTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const noteComposingRef = useRef(false);
  const [gestureMode, setGestureMode] = useState<GestureMode>("idle");
  const [previewScore, setPreviewScore] = useState<number | null>(draft.score);
  const [dragX, setDragX] = useState(0);
  const [showReasons, setShowReasons] = useState(draft.state === "rated");
  const [revealing, setRevealing] = useState(false);
  const [wobble, setWobble] = useState(false);
  const [rebound, setRebound] = useState(false);
  const [previewCovered, setPreviewCovered] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(draft.note);

  useEffect(() => {
    sessionRef.current = null;
    setGestureMode("idle");
    setPreviewScore(draft.score);
    setDragX(0);
    setShowReasons(draft.state === "rated");
    setRevealing(false);
    setWobble(false);
    setRebound(false);
    setNoteOpen(false);
    setNoteDraft(draft.note);
    if (dish.previewOnly) setPreviewCovered(true);
  }, [dish.id, draft.score, draft.state]);

  useEffect(() => {
    if (!noteOpen && !noteComposingRef.current) setNoteDraft(draft.note);
  }, [draft.note, noteOpen]);

  useEffect(() => () => {
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    if (reboundTimerRef.current) window.clearTimeout(reboundTimerRef.current);
  }, []);

  const covered = dish.previewOnly ? previewCovered : !dish.overall && draft.state === "unopened";
  const notEaten = !dish.previewOnly && draft.state === "not_eaten";
  const activelyRating = gestureMode === "vertical-rating" && !covered && !notEaten;
  const visibleScore = activelyRating ? previewScore : draft.state === "rated" ? draft.score : null;
  const expressionScore = visibleScore ?? undefined;
  const reasonScore = visibleScore ?? draft.score ?? 50;
  const reasonSet = reasonsFor(dish, reasonScore);
  const canRate = !dish.previewOnly && !locked && !notEaten && (dish.overall || draft.state !== "unopened");
  const transitionVariant = transitionRevision % 2 === 0 ? " is-transition-a" : " is-transition-b";
  const courseTransitionClass = transitionDirection > 0
    ? ` is-entering-next${transitionVariant}`
    : transitionDirection < 0
      ? ` is-entering-previous${transitionVariant}`
      : "";

  const triggerRebound = () => {
    setRebound(false);
    window.requestAnimationFrame(() => setRebound(true));
    if (reboundTimerRef.current) window.clearTimeout(reboundTimerRef.current);
    reboundTimerRef.current = window.setTimeout(() => setRebound(false), 420);
  };

  const beginPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (locked) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const control = event.target instanceof Element
      ? event.target.closest("button, input, textarea")
      : null;
    if (control && !control.matches(".cloche-button, .preview-dish-toggle")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScore: draft.score ?? 50,
      mode: "pending",
      startedOnCloche: event.target instanceof Element && Boolean(event.target.closest(".cloche-button")),
      startedOnPreviewDish: event.target instanceof Element && Boolean(event.target.closest(".preview-dish-toggle")),
    };
    setGestureMode("pending");
    setPreviewScore(draft.score);
  };

  const movePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;

    if (session.mode === "pending") {
      if (Math.hypot(dx, dy) < directionThreshold) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.15) session.mode = "horizontal-dish";
      else if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        if (dish.confirmation === "draft") return;
        session.mode = "vertical-rating";
      }
      else return;
      setGestureMode(session.mode);
      if (session.mode === "vertical-rating") setShowReasons(false);
    }

    if (session.mode === "horizontal-dish") {
      event.preventDefault();
      setDragX(Math.max(-110, Math.min(110, dx)));
      return;
    }

    if (session.mode === "vertical-rating") {
      event.preventDefault();
      if (!canRate) {
        if (covered) setWobble(true);
        return;
      }
      setPreviewScore(clampScore(session.startScore - dy / pixelsPerPoint));
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const mode = session.mode;
    sessionRef.current = null;
    setGestureMode("idle");

    if (mode === "pending" && dish.confirmation !== "draft" && covered && session.startedOnCloche) {
      revealDish();
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      return;
    }

    if (mode === "pending" && dish.previewOnly && !covered && session.startedOnPreviewDish) {
      setPreviewCovered(true);
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      return;
    }

    if (mode === "horizontal-dish") {
      suppressClickRef.current = true;
      if (Math.abs(dragX) >= switchThreshold) onNavigate(dragX < 0 ? 1 : -1);
      setDragX(0);
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      return;
    }

    if (mode === "vertical-rating") {
      suppressClickRef.current = true;
      if (canRate && previewScore !== null) {
        onScoreCommit(previewScore);
        setShowReasons(true);
        triggerRebound();
      } else if (covered) {
        setWobble(true);
        window.setTimeout(() => setWobble(false), 360);
      }
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  };

  const cancelPointer = () => {
    sessionRef.current = null;
    setGestureMode("idle");
    setPreviewScore(draft.score);
    setDragX(0);
    setWobble(false);
  };

  const revealDish = () => {
    if (dish.confirmation === "draft" || !covered || revealing || suppressClickRef.current) return;
    setRevealing(true);
    revealTimerRef.current = window.setTimeout(() => {
      if (dish.previewOnly) setPreviewCovered(false);
      else onOpen();
      setRevealing(false);
    }, 320);
  };

  const recoverPreview = () => {
    if (!dish.previewOnly || covered || suppressClickRef.current) return;
    setPreviewCovered(true);
  };

  const keyboardScore = (score: number) => {
    setPreviewScore(score);
    onScoreCommit(score);
    setShowReasons(true);
    triggerRebound();
  };

  if (dish.confirmation === "draft") {
    return (
      <section className="rating-card rating-card--scene rating-card--confirmation" aria-labelledby="draftTitle">
        <header className="dish-heading">
          <div className="dish-heading-copy">
            <p className="eyebrow">COURSE {String(dish.order).padStart(2, "0")} · {categoryLabels[dish.category]}</p>
            <div className="dish-title-line"><h2 id="draftTitle">{dish.name}</h2></div>
            <p className="dish-inline-meta">
              <span>{dish.description && dish.description !== "待補充內容" ? dish.description : "尚未補充料理內容"}</span>
              {dish.price ? <b>NT$ {dish.price.toLocaleString("zh-TW")}</b> : null}
            </p>
          </div>
          <ParticipantStrip dish={dish} participants={participants} currentParticipantId={currentParticipantId} />
        </header>

        <div
          className="table-rating-scene confirmation-scene"
          style={{ "--scene-player-color": participant.color } as CSSProperties}
          data-testid="dish-confirmation-stage"
          data-gesture-mode={gestureMode}
          onPointerDown={beginPointer}
          onPointerMove={movePointer}
          onPointerUp={finishPointer}
          onPointerCancel={cancelPointer}
        >
          <div className="confirmation-state" role="status">
            <Check weight="bold" aria-hidden="true" />
            <span><strong>菜名待確認</strong><small>確認後即可揭蓋評分</small></span>
          </div>
          <div className="scene-avatar-fixed">
            <Avatar participant={participant} variant="stage" decorative />
          </div>
          <SceneTableArtwork />
          <div className={`scene-course-layer${courseTransitionClass}`}>
            <ScenePlateArtwork dragX={dragX} />
            <div className="scene-dome-wrap"><SceneDomeArtwork dragX={dragX} /></div>
          </div>
        </div>

        <div className="confirmation-tray">
          <span><strong>辨識結果</strong><small>請確認菜名是否正確</small></span>
          <button className="primary-button" type="button" onClick={onConfirm}>確認菜名</button>
        </div>
      </section>
    );
  }

  return (
    <section className="rating-card rating-card--scene" aria-labelledby="dishTitle">
      <header className="dish-heading">
        <div className="dish-heading-copy">
          <p className="eyebrow">{dish.previewOnly ? "DEMO · 場景預覽" : dish.overall ? "TOTAL · VISIT" : `COURSE ${String(dish.order).padStart(2, "0")} · ${categoryLabels[dish.category]}`}</p>
          <div className="dish-title-line"><h2 id="dishTitle">{dish.name}</h2></div>
          <p className="dish-inline-meta">
            <span>{dish.description && dish.description !== "待補充內容" ? dish.description : "尚未補充料理內容"}</span>
            {dish.price ? <b>NT$ {dish.price.toLocaleString("zh-TW")}</b> : null}
          </p>
        </div>
        {dish.previewOnly
          ? <span className="preview-badge">可重複揭蓋</span>
          : <ParticipantStrip dish={dish} participants={participants} currentParticipantId={currentParticipantId} />}
      </header>

      <div
        className={`table-rating-scene${locked ? " is-locked" : ""}${notEaten ? " is-not-eaten" : ""}${wobble ? " is-wobbling" : ""}`}
        style={{ "--scene-player-color": participant.color } as CSSProperties}
        data-testid="rating-stage"
        data-gesture-mode={gestureMode}
        onPointerDown={beginPointer}
        onPointerMove={movePointer}
        onPointerUp={finishPointer}
        onPointerCancel={cancelPointer}
      >
        {!dish.previewOnly && (
          <div className="scene-score" aria-live="polite">
            <output><b>{visibleScore ?? "—"}</b><span>/100</span></output>
            <strong>{visibleScore === null ? "還沒評分" : scoreLabel(visibleScore)}</strong>
            <small className={`sync-state is-${syncState}`}>{syncLabel(syncState)}</small>
          </div>
        )}

        {dish.previewOnly && (
          <div className="scene-scale-ruler" aria-hidden="true">
            {sceneRulerMarks.map((mark) => (
              <i
                key={mark}
                className={mark % 20 === 0 || mark === 90 ? "is-labelled" : ""}
                style={{ top: `${mark}%` }}
              >
                {(mark % 20 === 0 || mark === 90) && <b>{mark}%</b>}
              </i>
            ))}
          </div>
        )}

        <div className="scene-avatar-fixed">
          <Avatar participant={participant} variant="stage" score={expressionScore} rebound={rebound} decorative />
        </div>

        <SceneTableArtwork />
        <div className={`scene-course-layer${courseTransitionClass}`}>
          <ScenePlateArtwork dragX={dragX} hidden={notEaten} />
          <DishVisual recipe={dish.visualRecipe} overall={dish.overall} preview={dish.previewOnly} hidden={covered || notEaten} dragX={dragX} />

          {dish.previewOnly && !covered && (
            <button className="preview-dish-toggle" type="button" aria-label="重新蓋上罩子" onClick={recoverPreview} />
          )}

          {covered && (
            <>
              <div className={revealing ? "scene-dome-wrap is-revealing" : "scene-dome-wrap"}>
                <SceneDomeArtwork dragX={dragX} />
              </div>
              <button
                className="cloche-button"
                type="button"
                aria-label={`揭開 ${dish.name}`}
                onClick={revealDish}
              >
                <small>點一下揭開</small>
              </button>
            </>
          )}
        </div>

        {notEaten && <p className="not-eaten-message">這道沒吃到</p>}
        {locked && (
          <div className="scene-lock-message">
            <LockSimple weight="duotone" />
            <strong>{emptyMenu ? "先新增至少一道餐點" : `還有 ${remainingCount} 道未處理`}</strong>
            <small>{emptyMenu ? "有餐點後，才會開放整體用餐評分。" : "評分或標記沒吃到後，就能填整體評價。"}</small>
            <button type="button" onClick={onGoToUnfinished}>{emptyMenu ? "新增第一道餐點" : "前往第一道"}</button>
          </div>
        )}

        {!dish.previewOnly && !covered && !notEaten && visibleScore === null && !locked && (
          <p className="first-rating-hint">上下滑動開始評分</p>
        )}
        {covered && wobble && <p className="first-rating-hint">先揭開看看</p>}

        {!dish.overall && !dish.previewOnly && !locked && (
          <button className="not-eaten-toggle" type="button" onClick={onToggleNotEaten}>
            {notEaten ? "改成我要評" : "沒吃到這道"}
          </button>
        )}

        {dish.overall && draft.state === "rated" && !locked && (
          <button
            className={`ready-button${ready ? " is-ready" : ""}${readyPending ? " is-pending" : ""}`}
            type="button"
            disabled={readyPending}
            aria-busy={readyPending}
            onClick={onToggleReady}
          >
            {readyPending
              ? <><CircleNotch className="ready-spinner" weight="bold" aria-hidden="true" />正在確認…</>
              : ready ? "已準備 · 點擊取消" : "我評完了"}
          </button>
        )}

        <input
          className="sr-only"
          type="range"
          min="0"
          max="100"
          value={draft.score ?? 50}
          disabled={!canRate}
          aria-label={`${dish.name}喜愛度`}
          aria-valuetext={visibleScore === null ? "尚未評分" : `${visibleScore} 分，${scoreLabel(visibleScore)}`}
          onChange={(event) => keyboardScore(Number(event.target.value))}
        />
      </div>

      {dish.previewOnly ? (
        <div className="preview-instructions" role="note">
          <span><strong>罩蓋場景測試</strong><small>點罩掀開 · 點料理蓋回 · 左右滑可離開</small></span>
          {onOpenResultPreview && <button type="button" onClick={onOpenResultPreview}>測試頒獎</button>}
        </div>
      ) : (
        <div className={`reason-tray${draft.state === "rated" && showReasons && !locked ? " is-visible" : ""}${noteOpen ? " is-note-open" : ""}`} aria-hidden={draft.state !== "rated" || !showReasons || locked}>
          <div className="reason-tray-copy">
            <strong>{reasonSet.prompt}</strong>
            <small>最多選 3 個</small>
          </div>
          <div className="reason-chips">
            {reasonSet.tags.map((reason) => {
              const selected = draft.selectedReasons.includes(reason);
              const limitReached = draft.selectedReasons.length >= 3 && !selected;
              return (
                <button
                  key={reason}
                  type="button"
                  tabIndex={draft.state === "rated" && showReasons && !locked ? 0 : -1}
                  disabled={locked || limitReached}
                  className={selected ? "is-selected" : limitReached ? "is-limit-disabled" : ""}
                  aria-pressed={selected}
                  onClick={() => onToggleReason(reason)}
                >
                  {reason}
                </button>
              );
            })}
            {!noteOpen && (
              <button
                className="rating-note-chip"
                type="button"
                tabIndex={draft.state === "rated" && showReasons && !locked ? 0 : -1}
                onClick={() => {
                  setNoteDraft(draft.note);
                  setNoteOpen(true);
                }}
              >
                <NotePencil weight="bold" aria-hidden="true" />
                <span>{draft.note.trim() || "寫一句"}</span>
              </button>
            )}
          </div>
          {noteOpen && (
            <div className="rating-note-control">
              <label>
                <span className="sr-only">{dish.overall ? "整體用餐評語" : `${dish.name}的評語`}</span>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={noteDraft}
                  autoFocus
                  placeholder={dish.overall ? "服務、環境、結帳或整體感受…" : "味道、口感，或下次想提醒自己的事…"}
                  onCompositionStart={() => { noteComposingRef.current = true; }}
                  onCompositionEnd={(event) => {
                    noteComposingRef.current = false;
                    const value = event.currentTarget.value.slice(0, 300);
                    setNoteDraft(value);
                    onNoteChange(value);
                  }}
                  onChange={(event) => {
                    const value = event.target.value.slice(0, 300);
                    setNoteDraft(value);
                    if (!(event.nativeEvent as InputEvent).isComposing && !noteComposingRef.current) onNoteChange(value);
                  }}
                  onBlur={() => {
                    noteComposingRef.current = false;
                    onNoteChange(noteDraft);
                    onNoteBlur();
                    setNoteOpen(false);
                  }}
                />
                <small>{noteDraft.length}/300</small>
              </label>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
