import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { BottomSheet } from "./BottomSheet";
import type { Dish, Participant } from "../types";

interface ParticipantStripProps {
  dish: Dish;
  participants: Participant[];
  currentParticipantId: string;
}

const visibleLimit = 5;

export function ParticipantStrip({ dish, participants, currentParticipantId }: ParticipantStripProps) {
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  const voters = useMemo(() => {
    const included = participants.filter((participant) => {
      const status = dish.participantStatus[participant.id];
      return status !== "not_eaten";
    });

    return [...included].sort((left, right) => {
      if (left.id === currentParticipantId) return -1;
      if (right.id === currentParticipantId) return 1;
      return participants.indexOf(left) - participants.indexOf(right);
    });
  }, [currentParticipantId, dish.participantStatus, participants]);

  const completed = voters.filter(
    (participant) => dish.participantStatus[participant.id] === "rated",
  ).length;
  const visible = voters.slice(0, visibleLimit);
  const overflow = Math.max(0, voters.length - visibleLimit);

  useEffect(() => {
    if (!activeParticipantId) return;
    const closeTooltip = (event: PointerEvent) => {
      if (!stripRef.current?.contains(event.target as Node)) setActiveParticipantId(null);
    };
    document.addEventListener("pointerdown", closeTooltip);
    return () => document.removeEventListener("pointerdown", closeTooltip);
  }, [activeParticipantId]);

  useEffect(() => {
    setActiveParticipantId(null);
    setShowAll(false);
  }, [dish.id]);

  const statusText = (participant: Participant) => (
    dish.participantStatus[participant.id] === "rated" ? "已評" : "未評"
  );

  return (
    <>
      <div
        ref={stripRef}
        className="participant-progress"
        aria-label={`${completed} / ${voters.length} 人已評分`}
      >
        <div className="participant-stack">
          {visible.map((participant) => {
            const done = dish.participantStatus[participant.id] === "rated";
            const active = activeParticipantId === participant.id;
            return (
              <span className="participant-token" key={participant.id}>
                <button
                  className={`participant-avatar-button ${done ? "is-complete" : "is-pending"}${participant.id === currentParticipantId ? " is-self" : ""}`}
                  type="button"
                  aria-label={`${participant.name}，${statusText(participant)}`}
                  aria-expanded={active}
                  onClick={() => setActiveParticipantId(active ? null : participant.id)}
                >
                  <Avatar participant={participant} variant="bust" decorative />
                </button>
                {active && (
                  <span className="participant-tooltip" role="status">
                    <strong>{participant.name}</strong>
                    <small>{statusText(participant)}</small>
                  </span>
                )}
              </span>
            );
          })}
          {overflow > 0 && (
            <button
              className="participant-overflow"
              type="button"
              aria-label={`查看其餘 ${overflow} 位成員`}
              onClick={() => {
                setActiveParticipantId(null);
                setShowAll(true);
              }}
            >
              +{overflow}
            </button>
          )}
        </div>
        <span className="participant-count"><strong>{completed}/{voters.length}</strong> 已評</span>
      </div>

      <BottomSheet
        open={showAll}
        title="這道菜的評分進度"
        eyebrow={`${dish.name} · ${completed}/${voters.length} 已評`}
        onClose={() => setShowAll(false)}
      >
        <div className="participant-list">
          {voters.map((participant) => {
            const done = dish.participantStatus[participant.id] === "rated";
            return (
              <div className="participant-list-row" key={participant.id}>
                <span className={done ? "is-complete" : "is-pending"}>
                  <Avatar participant={participant} variant="profile" decorative />
                </span>
                <strong>{participant.name}{participant.id === currentParticipantId ? "（你）" : ""}</strong>
                <small className={done ? "is-complete" : "is-pending"}>{done ? "已評" : "未評"}</small>
              </div>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
