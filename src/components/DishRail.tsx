import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eye, ForkKnife, ListBullets, Plus } from "@phosphor-icons/react";
import type { Dish, ParticipationStatus } from "../types";

interface DishRailProps {
  dishes: Dish[];
  activeId: string;
  currentParticipantId: string;
  remainingCount: number;
  onSelect: (dishId: string) => void;
  onOpenDetails: () => void;
  onOpenAdd: () => void;
}

interface RailPointerSession {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  timer: number;
  active: boolean;
  moved: boolean;
  previewId: string;
}

const longPressDelay = 320;
const railMoveThreshold = 7;

function stateClass(status: ParticipationStatus | undefined) {
  if (status === "rated") return "is-complete";
  if (status === "not_eaten") return "is-excluded";
  if (status === "opened") return "is-opened";
  return "is-unopened";
}

function stateLabel(status: ParticipationStatus | undefined) {
  if (status === "rated") return "已評";
  if (status === "not_eaten") return "沒吃到";
  if (status === "opened") return "已揭蓋，未評";
  return "尚未揭蓋";
}

export function DishRail({
  dishes,
  activeId,
  currentParticipantId,
  remainingCount,
  onSelect,
  onOpenDetails,
  onOpenAdd,
}: DishRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const pointerSessionRef = useRef<RailPointerSession | null>(null);
  const suppressClickRef = useRef(false);
  const [scrubPreviewId, setScrubPreviewId] = useState<string | null>(null);
  const scrubPreviewDish = dishes.find((dish) => dish.id === scrubPreviewId);
  const scrubPreviewIndex = scrubPreviewDish ? dishes.findIndex((dish) => dish.id === scrubPreviewDish.id) : -1;

  const dishIdAtPoint = (clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-dish-id]");
    return target?.dataset.dishId && dishes.some((dish) => dish.id === target.dataset.dishId)
      ? target.dataset.dishId
      : null;
  };

  const beginRailPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const source = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-dish-id]") : null;
    const previewId = source?.dataset.dishId;
    if (!previewId) return;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the scrub still works without it.
    }
    const session: RailPointerSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: event.currentTarget.scrollLeft,
      timer: 0,
      active: false,
      moved: false,
      previewId,
    };
    session.timer = window.setTimeout(() => {
      session.active = true;
      setScrubPreviewId(session.previewId);
    }, longPressDelay);
    pointerSessionRef.current = session;
  };

  const moveRailPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;

    if (session.active) {
      event.preventDefault();
      const previewId = dishIdAtPoint(event.clientX, event.clientY);
      if (previewId && previewId !== session.previewId) {
        session.previewId = previewId;
        setScrubPreviewId(previewId);
      }
      return;
    }

    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > railMoveThreshold) {
      window.clearTimeout(session.timer);
      return;
    }

    if (Math.abs(dx) > railMoveThreshold) {
      session.moved = true;
      window.clearTimeout(session.timer);
      event.preventDefault();
      event.currentTarget.scrollLeft = session.startScrollLeft - dx;
    }
  };

  const finishRailPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    window.clearTimeout(session.timer);
    pointerSessionRef.current = null;
    setScrubPreviewId(null);

    if (session.active || session.moved) {
      suppressClickRef.current = true;
      if (session.active) onSelect(session.previewId);
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  };

  const cancelRailPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    window.clearTimeout(session.timer);
    pointerSessionRef.current = null;
    setScrubPreviewId(null);
  };

  return (
    <section className="dish-rail-wrap" aria-label="本桌菜色導航">
      <div className="dish-rail" data-testid="dish-rail">
        <button className="rail-tool" type="button" onClick={onOpenDetails} aria-label="開啟本桌明細">
          <ListBullets weight="bold" />
        </button>
        <div
          ref={railRef}
          className={`rail-dishes${scrubPreviewId ? " is-scrubbing" : ""}`}
          onPointerDown={beginRailPointer}
          onPointerMove={moveRailPointer}
          onPointerUp={finishRailPointer}
          onPointerCancel={cancelRailPointer}
          onContextMenu={(event) => event.preventDefault()}
        >
          {dishes.map((dish) => {
            const selected = dish.id === activeId;
            const status = dish.participantStatus[currentParticipantId];
            const locked = Boolean(dish.overall && remainingCount > 0);
            const preview = Boolean(dish.previewOnly);
            return (
              <button
                key={dish.id}
                type="button"
                className={`rail-dish ${selected ? "is-active" : ""} ${preview ? "is-preview" : stateClass(status)}${dish.overall ? " is-overall" : ""}${locked ? " is-locked" : ""}${scrubPreviewId === dish.id ? " is-scrub-preview" : ""}`}
                data-dish-id={dish.id}
                data-category={dish.category}
                aria-current={selected ? "true" : undefined}
                aria-label={`${dish.name}，${preview ? "場景預覽" : locked ? `尚有 ${remainingCount} 道未完成` : stateLabel(status)}`}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    event.preventDefault();
                    return;
                  }
                  onSelect(dish.id);
                }}
              >
                {preview ? <Eye weight="bold" /> : dish.overall ? <ForkKnife weight="bold" /> : <span className="rail-dot" />}
                <span className="rail-dish-name">{dish.overall ? "整體" : dish.name}</span>
                {locked && <span className="rail-lock-count">{remainingCount}</span>}
              </button>
            );
          })}
        </div>
        <button className="rail-tool rail-add" type="button" onClick={onOpenAdd} aria-label="快速新增菜色">
          <Plus weight="bold" />
        </button>
      </div>
      <div className={`rail-preview${scrubPreviewDish ? " is-visible" : ""}`} role="status" aria-live="polite" aria-hidden={!scrubPreviewDish}>
        <span>快速預覽</span>
        <strong>{scrubPreviewDish?.overall ? "整體用餐" : scrubPreviewDish?.name ?? ""}</strong>
        <small>{scrubPreviewDish ? `${scrubPreviewIndex + 1}/${dishes.length}` : ""}</small>
      </div>
    </section>
  );
}
