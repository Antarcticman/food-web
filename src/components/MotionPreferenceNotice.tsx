import { useEffect, useState } from "react";
import { enableFullMotion, motionPreferenceKey } from "../lib/motionPreference";

export function MotionPreferenceNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const reducedByBrowser = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const alreadyOverridden = window.localStorage.getItem(motionPreferenceKey) === "full";
    setVisible(reducedByBrowser && !alreadyOverridden);
  }, []);

  if (!visible) return null;

  return (
    <aside className="motion-notice" aria-label="動態效果設定">
      <span>
        <strong>動畫目前被瀏覽器關閉</strong>
        <small>恢復揭蓋、切菜與揭幕效果</small>
      </span>
      <button
        type="button"
        onClick={() => {
          enableFullMotion();
          setVisible(false);
        }}
      >
        恢復動畫
      </button>
    </aside>
  );
}
