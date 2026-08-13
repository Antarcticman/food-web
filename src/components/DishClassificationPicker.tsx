import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import {
  allCourseRoles,
  allIngredientFamilies,
  courseRoleLabels,
  ingredientFamilyLabels,
  suggestDishClassification,
} from "../data/dishClassification";
import type { DishCourseRole, DishIngredientFamily } from "../types";

interface DishClassificationPickerProps {
  name: string;
  description?: string;
  courseRole: DishCourseRole;
  ingredientFamilies: DishIngredientFamily[];
  onCourseRoleChange: (role: DishCourseRole) => void;
  onIngredientFamiliesChange: (families: DishIngredientFamily[]) => void;
  compact?: boolean;
  disabled?: boolean;
}

export function DishClassificationPicker({
  name,
  description = "",
  courseRole,
  ingredientFamilies,
  onCourseRoleChange,
  onIngredientFamiliesChange,
  compact = false,
  disabled = false,
}: DishClassificationPickerProps) {
  const [showAll, setShowAll] = useState(false);
  const suggestion = useMemo(
    () => suggestDishClassification(name, description),
    [description, name],
  );

  useEffect(() => {
    if (!name.trim()) setShowAll(false);
  }, [name]);

  const visibleRoles = showAll
    ? allCourseRoles
    : [...new Set([...suggestion.courseRoleSuggestions, courseRole])];
  const visibleIngredients = showAll
    ? allIngredientFamilies
    : [...new Set([...suggestion.ingredientSuggestions, ...ingredientFamilies])];

  const toggleIngredient = (ingredient: DishIngredientFamily) => {
    if (disabled) return;
    if (ingredientFamilies.includes(ingredient)) {
      onIngredientFamiliesChange(ingredientFamilies.filter((item) => item !== ingredient));
      return;
    }
    if (ingredientFamilies.length < 3) onIngredientFamiliesChange([...ingredientFamilies, ingredient]);
  };

  return (
    <section className={`classification-card${compact ? " classification-card--compact" : ""}`} aria-label={`${name || "料理"}分類`}>
      <fieldset className="classification-group" disabled={disabled}>
        <legend>餐序</legend>
        <div className="classification-chips">
          {visibleRoles.map((role) => (
            <button
              key={role}
              className={courseRole === role ? "is-selected" : ""}
              type="button"
              aria-pressed={courseRole === role}
              onClick={() => onCourseRoleChange(role)}
            >
              {courseRoleLabels[role]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="classification-group" disabled={disabled}>
        <legend>主要食材 <span>最多 3 個</span></legend>
        <div className="classification-chips">
          {visibleIngredients.map((ingredient) => {
            const selected = ingredientFamilies.includes(ingredient);
            const limitReached = !selected && ingredientFamilies.length >= 3;
            return (
              <button
                key={ingredient}
                className={selected ? "is-selected" : ""}
                type="button"
                aria-pressed={selected}
                disabled={disabled || limitReached}
                onClick={() => toggleIngredient(ingredient)}
              >
                {ingredientFamilyLabels[ingredient]}
              </button>
            );
          })}
        </div>
      </fieldset>

      {!disabled && (
        <button
          className="classification-expand"
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "收起完整分類" : "調整完整分類"}
          {showAll ? <CaretUp weight="bold" /> : <CaretDown weight="bold" />}
        </button>
      )}
    </section>
  );
}
