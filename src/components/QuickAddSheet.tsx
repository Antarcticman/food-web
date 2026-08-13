import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, MagicWand } from "@phosphor-icons/react";
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
  const [chosenCourseRole, setChosenCourseRole] = useState<DishCourseRole | null>(null);
  const [chosenIngredientFamilies, setChosenIngredientFamilies] = useState<DishIngredientFamily[] | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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
    setChosenCourseRole(null);
    setChosenIngredientFamilies(null);
    setFileName("");
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

        <DishClassificationPicker
          name={name}
          description={description}
          courseRole={courseRole}
          ingredientFamilies={ingredientFamilies}
          onCourseRoleChange={setChosenCourseRole}
          onIngredientFamiliesChange={setChosenIngredientFamilies}
        />

        <button className="scan-action scan-action--compact" type="button" onClick={() => fileRef.current?.click()}>
          <span><Camera weight="duotone" /></span>
          <div><strong>從照片加入多道菜</strong><small>菜單辨識仍是下一階段；目前可先選照片保留流程</small></div>
        </button>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept="image/*"
          aria-label="選擇菜單照片"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
        />
        {fileName && (
          <div className="ocr-placeholder" role="status">
            <MagicWand weight="duotone" />
            <div><strong>{fileName}</strong><small>照片已選取；OCR 串接完成前不會上傳或產生費用。</small></div>
          </div>
        )}

        <div className="quick-add-actions">
          <button className="primary-button" type="submit" disabled={!name.trim()}>加入待確認菜色</button>
          <p>加入後仍可修改菜名與分類；確認菜名後才進入評分。</p>
        </div>
      </form>
    </BottomSheet>
  );
}
