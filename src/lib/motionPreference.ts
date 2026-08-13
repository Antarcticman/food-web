export const motionPreferenceKey = "tastelog.motion-preference";

export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  if (window.localStorage.getItem(motionPreferenceKey) === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function initializeMotionPreference() {
  if (typeof window === "undefined") return;
  const applyPreference = () => {
    document.documentElement.classList.toggle(
      "motion-full",
      window.localStorage.getItem(motionPreferenceKey) === "full",
    );
  };
  applyPreference();
  window.addEventListener("storage", (event) => {
    if (event.key === motionPreferenceKey) applyPreference();
  });
}

export function enableFullMotion() {
  window.localStorage.setItem(motionPreferenceKey, "full");
  document.documentElement.classList.add("motion-full");
  window.dispatchEvent(new CustomEvent("tastelog:motion-preference"));
}
