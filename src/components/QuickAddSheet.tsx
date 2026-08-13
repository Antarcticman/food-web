import { useEffect, useMemo, useState } from "react";
import { suggestDishClassification } from "../data/dishClassification";
import type { DishCourseRole, DishIngredientFamily, NewDishInput } from "../types";
import { BottomSheet } from "./BottomSheet";
import { DishClassificationPicker } from "./DishClassificationPicker";

interface QuickAddSheetProps {
  open: boolean;
  onClose: () => void;
  onAdd: (dish: NewDishInput) => void;
}

export function QuickAddSheet({ open, onClose, onAdd }: QuickAddSheetProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [chosenCourseRole, setChosenCourseRole] = useState<DishCourseRole | null>(null);
  const [chosenIngredientFamilies, setChosenIngredientFamilies] = useState<DishIngredientFamily[] | null>(null);

  const suggestion = useMemo(
    () => suggestDishClassification(name, description),
    [name, description],
  );

  const courseRole = chosenCourseRole ?? suggestion.courseRole;
  const ingredientFamilies = chosenIngredientFamilies ?? suggestion.ingredientFamilies;

  useEffect(() => {
    if (open) return;
    setName("");
    setDescription("");
    setPrice("");
    setChosenCourseRole(null);
    setChosenIngredientFamilies(null);
  }, [open]);

  const updateName = (nextName: string) => {
    setName(nextName);
    setChosenCourseRole(null);
    setChosenIngredientFamilies(null);
  };

  const updateDescription = (nextDescription: string) => {
    setDescription(nextDescription);
    setChosenCourseRole(null);
    setChosenIngredientFamilies(null);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({
      name: trimmed,
      description: description.trim(),
      price: price.trim() ? Number(price) : undefined,
      courseRole,
      ingredientFamilies,
    });
    onClose();
  };

  return (
    <BottomSheet open={open} title="快速加菜" eyebrow="一起補齊本桌菜單" className="bottom-sheet--quick-add" onClose={onClose}>
      <form className="quick-add-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <div className="quick-add-field">
          <label className="field-label" htmlFor="manualDishName">菜名</label>
          <input
            id="manualDishName"
            className="quick-add-input"
            value={name}
            placeholder="例如：紅茶布丁"
            maxLength={180}
            onChange={(event) => updateName(event.target.value)}
          />
        </div>

        <div className="quick-add-field quick-add-field--description">
          <label className="field-label" htmlFor="dishDescription">補充內容 <small>選填</small></label>
          <textarea
            id="dishDescription"
            className="quick-add-textarea"
            value={description}
            placeholder="例如：焦糖、伯爵茶、鮮奶油"
            rows={2}
            maxLength={400}
            onChange={(event) => updateDescription(event.target.value)}
          />
        </div>

        <div className="quick-add-field quick-add-field--price">
          <label className="field-label" htmlFor="dishPrice">價格 <small>選填</small></label>
          <span className="quick-add-price-input">
            <b>NT$</b>
            <input
              id="dishPrice"
              className="quick-add-input"
              type="number"
              inputMode="numeric"
              min="0"
              max="9999999"
              step="1"
              value={price}
              placeholder="0"
              onChange={(event) => setPrice(event.target.value)}
            />
          </span>
        </div>

        <DishClassificationPicker
          name={name}
          description={description}
          courseRole={courseRole}
          ingredientFamilies={ingredientFamilies}
          onCourseRoleChange={setChosenCourseRole}
          onIngredientFamiliesChange={setChosenIngredientFamilies}
        />

        <div className="quick-add-actions">
          <button className="primary-button" type="submit" disabled={!name.trim()}>加入待確認菜色</button>
          <p>加入後仍可修改菜名與分類；確認菜名後才進入評分。</p>
        </div>
      </form>
    </BottomSheet>
  );
}
