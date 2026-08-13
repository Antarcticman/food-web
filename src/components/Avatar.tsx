import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { createAvatar, type CreateAvatarOptions } from "@humation/core";
import { humation1 } from "@humation/assets-humation-1";
import type { Participant } from "../types";

interface AvatarProps {
  participant: Participant;
  variant?: "profile" | "bust" | "stage" | "editor";
  score?: number;
  rebound?: boolean;
  decorative?: boolean;
  className?: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export const AVATAR_STROKE_COLOR = "#241F1B";
let avatarScopeSequence = 0;

function avatarOptions(participant: Participant): CreateAvatarOptions {
  return {
    selections: {
      head: participant.avatar.head,
      body: participant.avatar.body,
      bottom: "wide-pants",
      item: participant.avatar.item ?? "none",
      glasses: participant.avatar.glasses,
    },
    colors: {
      hair: participant.avatar.hair,
      skin: participant.avatar.skin,
      clothes: participant.avatar.clothes,
      bottom: "#626B63",
      stroke: AVATAR_STROKE_COLOR,
    },
    background: "transparent",
  };
}

function path(className: string, d: string) {
  const node = document.createElementNS(SVG_NS, "path");
  node.setAttribute("class", className);
  node.setAttribute("d", d);
  return node;
}

function ellipse(className: string, cx: string, cy: string, rx: string, ry: string, fill: string) {
  const node = document.createElementNS(SVG_NS, "ellipse");
  node.setAttribute("class", className);
  node.setAttribute("cx", cx);
  node.setAttribute("cy", cy);
  node.setAttribute("rx", rx);
  node.setAttribute("ry", ry);
  node.setAttribute("fill", fill);
  return node;
}

function scopeSvgStyles(svg: SVGSVGElement, scopeId: string) {
  svg.setAttribute("data-avatar-scope", scopeId);
  svg.querySelectorAll("style").forEach((style) => {
    style.textContent = (style.textContent ?? "").replace(
      /(^|})\s*([^{}]+)\s*\{/g,
      (match, closing: string, selectors: string) => {
        const selectorList = selectors.trim();
        if (!selectorList || selectorList.startsWith("@")) return match;
        const scoped = selectorList
          .split(",")
          .map((selector) => `[data-avatar-scope="${scopeId}"] ${selector.trim()}`)
          .join(", ");
        return `${closing}\n${scoped} {`;
      },
    );
  });
}

export function Avatar({
  participant,
  variant = "profile",
  score,
  rebound = false,
  decorative = false,
  className = "",
}: AvatarProps) {
  const mountRef = useRef<HTMLSpanElement>(null);
  const scopeIdRef = useRef("");
  if (!scopeIdRef.current) scopeIdRef.current = `avatar-${++avatarScopeSequence}`;
  const markup = useMemo(
    () => createAvatar(humation1, avatarOptions(participant)).toString(),
    [participant],
  );

  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // React must not rewrite Humation's SVG between score renders. Rebuild it
    // here, then add every expression layer in the same deterministic pass.
    mount.innerHTML = markup;
    const svg = mount.querySelector("svg");
    if (!svg) return;
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.classList.add("avatar-svg");
    scopeSvgStyles(svg, scopeIdRef.current);
    svg.querySelectorAll(".taste-expression").forEach((node) => node.remove());
    if (score === undefined) return;

    const safeScore = Math.max(0, Math.min(100, score));
    const glasses = svg.querySelector('[data-hm-layer-slot="glasses"]');
    const under = document.createElementNS(SVG_NS, "g");
    under.setAttribute("class", "taste-expression taste-expression--under");

    const brows = document.createElementNS(SVG_NS, "g");
    brows.setAttribute("class", "taste-brows");
    brows.style.opacity = safeScore < 40 ? "1" : "0";
    const anger = Math.max(0, Math.min(1, (40 - safeScore) / 40));
    const browOuterY = 33.55 - anger * 0.65;
    const browInnerY = 33.65 + anger * 0.7;
    const browControlY = 33.5 + anger * 0.05;
    const leftInnerX = 30.35 + anger * 0.15;
    const rightInnerX = 32.35 - anger * 0.15;
    brows.append(
      path(
        "taste-brow",
        `M27.35 ${browOuterY.toFixed(2)} Q28.9 ${browControlY.toFixed(2)} ${leftInnerX.toFixed(2)} ${browInnerY.toFixed(2)}`,
      ),
      path(
        "taste-brow",
        `M${rightInnerX.toFixed(2)} ${browInnerY.toFixed(2)} Q33.8 ${browControlY.toFixed(2)} 35.35 ${browOuterY.toFixed(2)}`,
      ),
    );

    const blinks = document.createElementNS(SVG_NS, "g");
    blinks.setAttribute("class", "taste-blinks");
    blinks.append(
      ellipse("taste-eye-cover", "29.12", "36.2", "1.75", "1.85", participant.avatar.skin),
      ellipse("taste-eye-cover", "33.66", "36.5", "1.75", "1.85", participant.avatar.skin),
      path("taste-lid", "M27.95 36.1 Q29.12 36.85 30.3 36.1"),
      path("taste-lid", "M32.48 36.4 Q33.66 37.15 34.84 36.4"),
    );
    under.append(brows, blinks);
    if (glasses?.parentNode) glasses.parentNode.insertBefore(under, glasses);
    else svg.append(under);

    const above = document.createElementNS(SVG_NS, "g");
    above.setAttribute("class", "taste-expression taste-expression--above");
    const mouthControlY = safeScore < 40
      ? 39.5 + safeScore * 0.075
      : 40.6 + safeScore * 0.048;
    const mouthStart = safeScore < 40 ? 28.95 : 29.45;
    const mouthEnd = safeScore < 40 ? 34.35 : 33.85;
    above.append(path("taste-mouth", `M${mouthStart} 43.2 Q31.65 ${mouthControlY.toFixed(2)} ${mouthEnd} 43.2`));
    svg.append(above);
  }, [markup, participant.avatar.glasses, participant.avatar.skin, score]);

  const hasGlasses = participant.avatar.glasses !== "none";

  return (
    <span
      className={`avatar avatar--${variant}${hasGlasses ? " avatar--glasses" : ""}${rebound ? " is-rebounding" : ""} ${className}`}
      style={{ "--avatar-bg": participant.color } as CSSProperties}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : participant.name}
    >
      {score !== undefined && score >= 84 && (
        <span className={`avatar-halo${score >= 90 ? " avatar-halo--bright" : ""}`} aria-hidden="true" />
      )}
      {score !== undefined && score >= 90 && (
        <span className="avatar-sparkles" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <span className="avatar-motion">
        <span ref={mountRef} className="avatar-mount" />
      </span>
    </span>
  );
}
