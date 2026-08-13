import type { CSSProperties } from "react";
import type { DishVisualRecipe } from "../types";

interface DishVisualProps {
  recipe: DishVisualRecipe;
  overall?: boolean;
  preview?: boolean;
  hidden?: boolean;
  dragX?: number;
  variant?: "scene" | "result";
}

export function DishVisual({ recipe, overall = false, preview = false, hidden = false, dragX = 0, variant = "scene" }: DishVisualProps) {
  const style = {
    "--dish-drag-x": `${dragX}px`,
    "--dish-seed": recipe.seed % 7,
    "--dish-scale": recipe.scale ?? 1,
    "--dish-offset-x": `${recipe.offsetX ?? 0}px`,
    "--dish-offset-y": `${recipe.offsetY ?? 0}px`,
    // The shared plate sits on layer 6; food must remain above it and below the dome.
    zIndex: Math.min(8, Math.max(7, recipe.zIndex ?? 7)),
  } as CSSProperties;

  if (overall) {
    return null;
  }

  return (
    <div
      className={`dish-visual dish-visual--${recipe.category} palette-${recipe.palette}${preview ? " dish-visual--preview" : ""}${variant === "result" ? " dish-visual--result" : ""}${hidden ? " is-hidden" : ""}`}
      style={style}
      data-category={recipe.category}
      aria-hidden="true"
    >
      {preview ? (
        <span className="dish-food-layer dish-food-layer--preview">
          <i className="preview-sauce" />
          <i className="preview-scallop preview-scallop--one" />
          <i className="preview-scallop preview-scallop--two" />
          <i className="preview-scallop preview-scallop--three" />
          <i className="preview-garnish preview-garnish--one" />
          <i className="preview-garnish preview-garnish--two" />
          <i className="preview-garnish preview-garnish--three" />
        </span>
      ) : recipe.assetUrl ? (
        <img className="dish-asset" src={recipe.assetUrl} alt="" draggable={false} />
      ) : (
        <>
          <span className={`dish-food-layer dish-food-layer--${recipe.vessel}`}>
            <i className="food-shape food-shape--base" />
            <i className="food-shape food-shape--accent" />
            <i className="food-shape food-shape--garnish" />
          </span>
          {(recipe.category === "soup" || recipe.category === "noodle") && <span className="dish-steam"><i /><i /></span>}
          {recipe.category === "drink" && <span className="dish-bubbles"><i /><i /><i /></span>}
        </>
      )}
    </div>
  );
}
