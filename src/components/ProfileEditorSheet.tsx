import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Check, Eyeglasses, Palette, SignOut, Sparkle, TShirt, UserFocus } from "@phosphor-icons/react";
import {
  AVATAR_BACKGROUND_COLORS,
  AVATAR_BODY_OPTIONS,
  AVATAR_CLOTHES_COLORS,
  AVATAR_GLASSES_OPTIONS,
  AVATAR_HAIR_COLORS,
  AVATAR_HEAD_OPTIONS,
  AVATAR_ITEM_OPTIONS,
  AVATAR_SKIN_COLORS,
} from "../lib/avatarRecipe";
import type { AvatarRecipe, Participant } from "../types";
import { useAuth } from "./AuthGate";
import { Avatar } from "./Avatar";
import { BottomSheet } from "./BottomSheet";

type EditorSection = "head" | "body" | "glasses" | "item" | "colors";

interface ProfileEditorSheetProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const sections: Array<{ id: EditorSection; label: string; icon: typeof UserFocus }> = [
  { id: "head", label: "髮型", icon: UserFocus },
  { id: "body", label: "上衣", icon: TShirt },
  { id: "glasses", label: "眼鏡", icon: Eyeglasses },
  { id: "item", label: "配件", icon: Sparkle },
  { id: "colors", label: "顏色", icon: Palette },
];

const optionNames: Record<string, string> = {
  none: "不要",
  round: "圓框",
  tiny: "小圓框",
  tee: "短袖上衣",
  shirt: "襯衫",
  jacket: "外套",
  hoodie: "帽T",
  polo: "Polo 衫",
  "tank-top": "背心",
  "cropped-shirt": "短版上衣",
  "drape-tee": "寬版上衣",
  "fluffy-bob": "蓬鬆短髮",
  "round-bob": "圓短髮",
  short: "俐落短髮",
  "curly-short": "短捲髮",
  "short-bangs": "短瀏海",
  "side-swept-short": "側分短髮",
  "messy-short": "微亂短髮",
  "wavy-medium": "中長波浪",
  "flipped-long": "外翹長髮",
  lob: "中長直髮",
  "long-straight": "長直髮",
  "side-swept-lob": "側分中長髮",
  "blunt-bob": "齊短髮",
  bun: "丸子頭",
  "low-side-bun": "低側髮髻",
  "low-twin-buns": "雙髮髻",
  ponytail: "馬尾",
  "low-ponytail": "低馬尾",
  "low-twin-tails": "低雙馬尾",
  braids: "辮子",
  "blunt-long": "齊長髮",
  "side-swept-long": "側分長髮",
  "wavy-long": "長波浪",
  "curly-long": "長捲髮",
};

function labelFor(value: string) {
  return optionNames[value] ?? value.replaceAll("-", " ");
}

export function ProfileEditorSheet({ open, onClose, onSaved }: ProfileEditorSheetProps) {
  const { profile, updateProfile, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [recipe, setRecipe] = useState<AvatarRecipe>(() => profile.avatarRecipe);
  const [section, setSection] = useState<EditorSection>("head");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisplayName(profile.displayName);
    setRecipe(profile.avatarRecipe);
    setSection("head");
    setError("");
    setConfirmSignOut(false);
  }, [open, profile]);

  const previewParticipant = useMemo<Participant>(() => ({
    id: profile.id,
    name: displayName.trim() || profile.displayName,
    color: recipe.background ?? "#F2B7A8",
    avatar: recipe,
  }), [displayName, profile.displayName, profile.id, recipe]);

  const updateRecipe = (key: keyof AvatarRecipe, value: string) => {
    setRecipe((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await updateProfile({ displayName, avatarRecipe: recipe });
      onSaved?.();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "儲存失敗，請再試一次");
    } finally {
      setSaving(false);
    }
  };

  const renderAvatarChoices = (key: "head" | "body" | "glasses" | "item", options: readonly string[]) => (
    <div className={`avatar-option-grid avatar-option-grid--${key}`} role="radiogroup" aria-label={sections.find((item) => item.id === key)?.label}>
      {options.map((value) => {
        const selected = (recipe[key] ?? "none") === value;
        const optionRecipe = { ...recipe, [key]: value };
        const optionParticipant: Participant = { ...previewParticipant, avatar: optionRecipe };
        return (
          <button
            key={value}
            className={`avatar-option${selected ? " is-selected" : ""}`}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={labelFor(value)}
            onClick={() => updateRecipe(key, value)}
          >
            <Avatar participant={optionParticipant} variant="editor" decorative />
            {selected && <i aria-hidden="true"><Check weight="bold" /></i>}
          </button>
        );
      })}
    </div>
  );

  const renderColors = () => (
    <div className="avatar-color-groups">
      {([
        ["hair", "髮色", AVATAR_HAIR_COLORS],
        ["skin", "膚色", AVATAR_SKIN_COLORS],
        ["clothes", "衣服", AVATAR_CLOTHES_COLORS],
      ] as const).map(([key, label, colors]) => (
        <fieldset key={key} className="avatar-color-group">
          <legend>{label}</legend>
          <div role="radiogroup" aria-label={label}>
            {colors.map((color) => (
              <button
                key={color}
                className={`avatar-color${recipe[key] === color ? " is-selected" : ""}`}
                style={{ backgroundColor: color }}
                type="button"
                role="radio"
                aria-checked={recipe[key] === color}
                aria-label={`${label} ${color}`}
                onClick={() => updateRecipe(key, color)}
              >
                {recipe[key] === color && <Check weight="bold" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset className="avatar-color-group">
        <legend>人物背景</legend>
        <div role="radiogroup" aria-label="人物背景">
          {AVATAR_BACKGROUND_COLORS.map((color) => (
            <button
              key={color}
              className={`avatar-color${recipe.background === color ? " is-selected" : ""}`}
              style={{ backgroundColor: color }}
              type="button"
              role="radio"
              aria-checked={recipe.background === color}
              aria-label={`人物背景 ${color}`}
              onClick={() => updateRecipe("background", color)}
            >
              {recipe.background === color && <Check weight="bold" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="avatar-stroke-note">人物線條固定為本站深咖啡色，保持所有人的畫風一致。</p>
    </div>
  );

  return (
    <BottomSheet open={open} title={profile.avatarConfigured ? "編輯我的角色" : "先做一個你的角色"} eyebrow="YOUR TASTING AVATAR" className="bottom-sheet--profile" onClose={() => { if (!saving) onClose(); }}>
      <form
        className="profile-editor"
        style={{ "--profile-avatar-background": recipe.background ?? "#F2B7A8" } as CSSProperties}
        onSubmit={(event) => void submit(event)}
      >
        <section className="profile-editor-preview" aria-label="角色預覽">
          <span className="profile-editor-halo" aria-hidden="true" />
          <Avatar participant={previewParticipant} variant="editor" decorative />
          <div>
            <label htmlFor="profile-display-name">大家怎麼叫你</label>
            <input
              id="profile-display-name"
              value={displayName}
              maxLength={24}
              autoComplete="nickname"
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <small>{profile.email}</small>
          </div>
        </section>

        <div className="avatar-editor-tabs" role="tablist" aria-label="角色編輯項目">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={section === item.id ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={section === item.id}
                onClick={() => setSection(item.id)}
              >
                <Icon weight={section === item.id ? "fill" : "regular"} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <section className="avatar-editor-panel" role="tabpanel">
          {section === "head" && renderAvatarChoices("head", AVATAR_HEAD_OPTIONS)}
          {section === "body" && renderAvatarChoices("body", AVATAR_BODY_OPTIONS)}
          {section === "glasses" && renderAvatarChoices("glasses", AVATAR_GLASSES_OPTIONS)}
          {section === "item" && renderAvatarChoices("item", AVATAR_ITEM_OPTIONS)}
          {section === "colors" && renderColors()}
        </section>

        {error && <p className="profile-editor-error" role="alert">{error}</p>}

        <footer className="profile-editor-actions">
          <button className="primary-button" type="submit" disabled={saving || !displayName.trim()}>
            {saving ? "正在儲存…" : "儲存我的角色"}
          </button>
          {!confirmSignOut ? (
            <button className="profile-sign-out" type="button" onClick={() => setConfirmSignOut(true)}>
              <SignOut aria-hidden="true" /> 登出帳號
            </button>
          ) : (
            <div className="profile-sign-out-confirm" role="group" aria-label="確認登出">
              <span>確定要登出？</span>
              <button type="button" onClick={() => setConfirmSignOut(false)}>取消</button>
              <button type="button" onClick={() => void signOut()}>登出</button>
            </div>
          )}
        </footer>
      </form>
    </BottomSheet>
  );
}
