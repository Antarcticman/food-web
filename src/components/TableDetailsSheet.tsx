import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CaretDown, CaretUp, DotsSixVertical, PencilSimple, Trash } from "@phosphor-icons/react";
import { BottomSheet } from "./BottomSheet";
import { Avatar } from "./Avatar";
import { DishClassificationPicker } from "./DishClassificationPicker";
import { dishClassificationSummary, suggestDishClassification } from "../data/dishClassification";
import type { Dish, DishCourseRole, DishIngredientFamily, Participant, ParticipationStatus } from "../types";

export interface DishEditInput {
  name: string;
  description: string;
  courseRole: DishCourseRole;
  ingredientFamilies: DishIngredientFamily[];
  participantIds: string[];
}

interface TableDetailsSheetProps {
  open: boolean;
  dishes: Dish[];
  participants: Participant[];
  currentParticipantId: string;
  onClose: () => void;
  onSelect: (dishId: string) => void;
  onReorder: (dishId: string, targetId: string) => void;
  onMove: (dishId: string, direction: -1 | 1) => void;
  isAdmin: boolean;
  onUpdateDish: (dishId: string, input: DishEditInput) => void;
  onDeleteDish: (dishId: string) => void;
  onNotify: (message: string) => void;
}

interface DragSession { pointerId: number; dishId: string; timer: number; active: boolean }
interface SwipeSession {
  pointerId: number;
  dishId: string;
  startX: number;
  startY: number;
  startOffset: number;
  offset: number;
  horizontal: boolean;
}

const DELETE_REVEAL_WIDTH = 68;

function statusLabel(status: ParticipationStatus | undefined) {
  if (status === "rated") return "已評";
  if (status === "not_eaten") return "沒吃到";
  if (status === "opened") return "已揭蓋，未評";
  return "尚未揭蓋";
}

export function TableDetailsSheet({ open, dishes, participants, currentParticipantId, onClose, onSelect, onReorder, onMove, isAdmin, onUpdateDish, onDeleteDish, onNotify }: TableDetailsSheetProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editRole, setEditRole] = useState<DishCourseRole>("other");
  const [editIngredients, setEditIngredients] = useState<DishIngredientFamily[]>([]);
  const [editParticipantIds, setEditParticipantIds] = useState<string[]>([]);
  const [revealedDeleteId, setRevealedDeleteId] = useState<string | null>(null);
  const [swipingId, setSwipingId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const overIdRef = useRef<string | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const swipeRef = useRef<SwipeSession | null>(null);
  const suppressClickRef = useRef(false);
  const regularDishes = dishes.filter((dish) => !dish.overall);
  const overall = dishes.find((dish) => dish.overall);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setRevealedDeleteId(null);
      setSwipingId(null);
      setSwipeOffset(0);
    }
  }, [open]);

  const openDishEditor = (dish: Dish) => {
    const hasRatings = Object.values(dish.participantStatus).some((status) => status === "rated");
    if (hasRatings && !isAdmin) {
      onNotify("已有朋友評分，分類需由 Admin 修正。");
      return;
    }
    if (editingId === dish.id) {
      setEditingId(null);
      return;
    }
    setEditName(dish.name);
    setEditDescription(dish.description);
    setEditRole(dish.courseRole ?? "other");
    setEditIngredients(dish.ingredientFamilies ?? []);
    setEditParticipantIds(participants
      .filter((participant) => dish.participantStatus[participant.id] !== undefined
        && dish.participantStatus[participant.id] !== "not_eaten")
      .map((participant) => participant.id));
    setRevealedDeleteId(null);
    setEditingId(dish.id);
  };

  const updateClassificationFor = (name: string, description: string) => {
    const suggestion = suggestDishClassification(name, description);
    setEditRole(suggestion.courseRole);
    setEditIngredients(suggestion.ingredientFamilies);
  };

  const updateEditName = (name: string) => {
    setEditName(name);
    updateClassificationFor(name, editDescription);
  };

  const updateEditDescription = (description: string) => {
    setEditDescription(description);
    updateClassificationFor(editName, description);
  };

  const saveDish = (dish: Dish) => {
    if (!editName.trim()) {
      onNotify("請輸入菜名");
      return;
    }
    if (!editParticipantIds.length) {
      onNotify("至少選一位有吃這道菜的人");
      return;
    }
    onUpdateDish(dish.id, {
      name: editName,
      description: editDescription,
      courseRole: editRole,
      ingredientFamilies: editIngredients,
      participantIds: editParticipantIds,
    });
    setEditingId(null);
  };

  const toggleParticipant = (participantId: string) => {
    setEditParticipantIds((current) => current.includes(participantId)
      ? current.filter((id) => id !== participantId)
      : [...current, participantId]);
  };

  const startSwipe = (event: ReactPointerEvent<HTMLDivElement>, dishId: string) => {
    const target = event.target as HTMLElement;
    if (target.closest(".drag-handle, .detail-tools, input, textarea, fieldset")) return;
    if (revealedDeleteId && revealedDeleteId !== dishId) setRevealedDeleteId(null);
    const startOffset = revealedDeleteId === dishId ? -DELETE_REVEAL_WIDTH : 0;
    swipeRef.current = {
      pointerId: event.pointerId,
      dishId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset,
      offset: startOffset,
      horizontal: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = swipeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    if (!session.horizontal && Math.abs(deltaX) < 8) return;
    if (!session.horizontal && Math.abs(deltaX) <= Math.abs(deltaY)) {
      swipeRef.current = null;
      return;
    }
    session.horizontal = true;
    suppressClickRef.current = true;
    event.preventDefault();
    session.offset = Math.max(-DELETE_REVEAL_WIDTH, Math.min(0, session.startOffset + deltaX));
    setSwipingId(session.dishId);
    setSwipeOffset(session.offset);
  };

  const endSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = swipeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.horizontal) {
      const reveal = session.offset < -DELETE_REVEAL_WIDTH * .45;
      setRevealedDeleteId(reveal ? session.dishId : null);
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
    setSwipingId(null);
    setSwipeOffset(0);
    swipeRef.current = null;
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, dishId: string) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const session: DragSession = { pointerId: event.pointerId, dishId, timer: 0, active: false };
    session.timer = window.setTimeout(() => {
      session.active = true;
      setDraggingId(dishId);
      setOverId(dishId);
      overIdRef.current = dishId;
    }, 180);
    dragRef.current = session;
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId || !session.active) return;
    event.preventDefault();
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-detail-row-id]");
    if (row?.dataset.detailRowId) {
      overIdRef.current = row.dataset.detailRowId;
      setOverId(row.dataset.detailRowId);
    }
    const sheet = event.currentTarget.closest<HTMLElement>(".bottom-sheet");
    if (sheet && event.clientY < 80) sheet.scrollBy({ top: -14 });
    if (sheet && event.clientY > window.innerHeight - 80) sheet.scrollBy({ top: 14 });
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    window.clearTimeout(session.timer);
    const targetId = overIdRef.current;
    if (session.active && targetId && targetId !== session.dishId) onReorder(session.dishId, targetId);
    dragRef.current = null;
    setDraggingId(null);
    setOverId(null);
    overIdRef.current = null;
  };

  const renderRow = (dish: Dish, index: number, sortable = true) => {
    const status = dish.participantStatus[currentParticipantId];
    const voters = Object.values(dish.participantStatus).filter((item) => item !== "not_eaten");
    const completed = Object.values(dish.participantStatus).filter((item) => item === "rated").length;
    const classificationSummary = dishClassificationSummary(dish);
    const editing = editingId === dish.id;
    const deleteRevealed = revealedDeleteId === dish.id;
    const revealOffset = swipingId === dish.id
      ? swipeOffset
      : deleteRevealed ? -DELETE_REVEAL_WIDTH : 0;
    return (
      <article
        key={dish.id}
        className={`detail-row${draggingId === dish.id ? " is-dragging" : ""}${overId === dish.id ? " is-over" : ""}${editing ? " is-editing" : ""}${deleteRevealed ? " is-delete-revealed" : ""}${swipingId === dish.id ? " is-swiping" : ""}`}
        data-detail-row-id={dish.id}
      >
        <div className="detail-swipe-shell">
          {sortable && (
            <button
              className="detail-swipe-delete"
              type="button"
              aria-label={`移除 ${dish.name}`}
              aria-hidden={!deleteRevealed}
              tabIndex={deleteRevealed ? 0 : -1}
              onClick={() => {
                onDeleteDish(dish.id);
                setRevealedDeleteId(null);
                setEditingId(null);
              }}
            >
              <Trash weight="bold" />
            </button>
          )}
          <div
            className="detail-swipe-surface"
            style={{ transform: `translate3d(${revealOffset}px, 0, 0)` }}
            onPointerDown={sortable ? (event) => startSwipe(event, dish.id) : undefined}
            onPointerMove={sortable ? moveSwipe : undefined}
            onPointerUp={sortable ? endSwipe : undefined}
            onPointerCancel={sortable ? endSwipe : undefined}
            onClickCapture={(event) => {
              if (!suppressClickRef.current) return;
              event.preventDefault();
              event.stopPropagation();
            }}
          >
          <div className="detail-row-main">
          {sortable ? (
            <button
              className="drag-handle"
              type="button"
              aria-label={`拖曳調整 ${dish.name} 排序`}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => startDrag(event, dish.id)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            ><DotsSixVertical weight="bold" /></button>
          ) : <span className="detail-total-mark">Σ</span>}
          <button className="detail-main-button" type="button" onClick={() => {
            if (deleteRevealed) {
              setRevealedDeleteId(null);
              return;
            }
            if (!dish.overall && status === undefined) {
              onNotify("這道菜目前沒有分配給你，可從編輯裡加入自己");
              return;
            }
            onSelect(dish.id);
            onClose();
          }}>
            <span className="detail-copy">
              <span>{dish.overall ? "TOTAL" : String(index + 1).padStart(2, "0")}</span>
              <strong>{dish.name}</strong>
              <small>{statusLabel(status)}{dish.price ? ` · NT$ ${dish.price}` : ""}</small>
              {!dish.overall && <small className="detail-classification-summary">{classificationSummary}</small>}
            </span>
          </button>
          <div className="detail-progress"><strong>{completed}/{voters.length}</strong><small>已評</small></div>
          {sortable && (
            <div className="detail-tools" onClick={(event) => event.stopPropagation()}>
              <button type="button" aria-label={`${dish.name} 上移`} disabled={index === 0} onClick={() => onMove(dish.id, -1)}><CaretUp /></button>
              <button type="button" aria-label={`${dish.name} 下移`} disabled={index === regularDishes.length - 1} onClick={() => onMove(dish.id, 1)}><CaretDown /></button>
              <button className={editing ? "is-active" : ""} type="button" aria-label={`編輯 ${dish.name}`} aria-expanded={editing} onClick={() => openDishEditor(dish)}><PencilSimple weight="bold" /></button>
            </div>
          )}
        </div>
          </div>
        </div>
        {editing && (
          <div className="detail-classification-editor">
            <div className="detail-edit-fields">
              <label>
                <span>菜名</span>
                <input value={editName} maxLength={180} onChange={(event) => updateEditName(event.target.value)} />
              </label>
              <label>
                <span>補充內容 <small>可留白</small></span>
                <textarea value={editDescription} maxLength={400} rows={2} onChange={(event) => updateEditDescription(event.target.value)} />
              </label>
            </div>
            <fieldset className="detail-consumer-picker">
              <legend>誰有吃這道菜？</legend>
              <div>
                {participants.map((participant) => {
                  const selected = editParticipantIds.includes(participant.id);
                  const rated = dish.participantStatus[participant.id] === "rated";
                  return (
                    <button
                      key={participant.id}
                      type="button"
                      className={selected ? "is-selected" : ""}
                      aria-pressed={selected}
                      disabled={rated && selected}
                      aria-label={`${participant.name}${selected ? "有吃" : "沒吃"}${rated ? "，已評分" : ""}`}
                      onClick={() => toggleParticipant(participant.id)}
                    >
                      <Avatar participant={participant} variant="profile" decorative />
                      <span>{participant.name}</span>
                      {rated && <small>已評</small>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <DishClassificationPicker
              compact
              name={editName}
              description={editDescription}
              courseRole={editRole}
              ingredientFamilies={editIngredients}
              onCourseRoleChange={setEditRole}
              onIngredientFamiliesChange={setEditIngredients}
            />
            <div className="detail-editor-actions">
              <button type="button" onClick={() => setEditingId(null)}>取消</button>
              <button type="button" onClick={() => saveDish(dish)}>儲存變更</button>
            </div>
          </div>
        )}
      </article>
    );
  };

  return (
    <BottomSheet open={open} title="本桌明細" eyebrow={`LUEUR · 今晚 ${dishes.length} 個項目`} onClose={onClose}>
      <p className="sheet-intro">點菜名切換；按住把手排序；向左滑可移除。</p>
      <div className="detail-list">
        {regularDishes.map((dish, index) => renderRow(dish, index))}
        {overall && renderRow(overall, regularDishes.length, false)}
      </div>
    </BottomSheet>
  );
}
