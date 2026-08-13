import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isAvatarRecipeConfigured, normalizeAvatarRecipe } from "../lib/avatarRecipe";
import { getSupabaseClient, isSupabaseConfigured } from "../lib/supabase";
import type { AvatarRecipe } from "../types";
import { MotionPreferenceNotice } from "./MotionPreferenceNotice";

type GateStatus = "loading" | "signed-out" | "ready" | "blocked" | "error";

interface AuthGateProps {
  children: ReactNode;
}

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  avatar_recipe: unknown;
  is_admin: boolean;
}

export interface AuthenticatedProfile {
  id: string;
  email: string;
  displayName: string;
  avatarRecipe: AvatarRecipe;
  avatarConfigured: boolean;
  isAdmin: boolean;
}

interface ProfileUpdate {
  displayName: string;
  avatarRecipe: AvatarRecipe;
}

interface AuthContextValue {
  session: Session;
  profile: AuthenticatedProfile;
  updateProfile: (update: ProfileUpdate) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthGate");
  return value;
}

function nameFromGoogle(user: User) {
  const metadataName = user.user_metadata.full_name ?? user.user_metadata.name;
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim().slice(0, 40);
  return (user.email?.split("@")[0] || "朋友").slice(0, 40);
}

function toProfile(row: ProfileRow): AuthenticatedProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarRecipe: normalizeAvatarRecipe(row.avatar_recipe),
    avatarConfigured: isAvatarRecipeConfigured(row.avatar_recipe),
    isAdmin: row.is_admin,
  };
}

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not allowlisted|row-level security|policy/i.test(message)) {
    return "這個 Google 帳號尚未加入好友名單，請請管理員確認信箱。";
  }
  return "登入暫時失敗，請稍後再試；若持續發生，再一起檢查 Supabase 設定。";
}

export function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<GateStatus>("loading");
  const [message, setMessage] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthenticatedProfile | null>(null);

  const prepareProfile = useCallback(async (nextSession: Session) => {
    const supabase = getSupabaseClient();
    const email = nextSession.user.email?.trim().toLowerCase();
    if (!supabase || !email) throw new Error("Google account has no email");

    const selectColumns = "id, email, display_name, avatar_recipe, is_admin";
    const { data: existing, error: readError } = await supabase
      .from("profiles")
      .select(selectColumns)
      .eq("id", nextSession.user.id)
      .maybeSingle<ProfileRow>();

    if (readError) throw readError;
    let row = existing;
    if (!row) {
      const { data: inserted, error: insertError } = await supabase
        .from("profiles")
        .insert({
          id: nextSession.user.id,
          email,
          display_name: nameFromGoogle(nextSession.user),
          avatar_recipe: {},
        })
        .select(selectColumns)
        .single<ProfileRow>();
      if (insertError) throw insertError;
      row = inserted;
    }

    setSession(nextSession);
    setProfile(toProfile(row));
    setMessage("");
    setStatus("ready");
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!isSupabaseConfigured() || !supabase) {
      setMessage("尚未設定 Supabase，請先確認 .env.local。");
      setStatus("error");
      return;
    }

    let active = true;
    let handledUserId: string | null = null;
    let ignoreNextSignedOut = false;
    const handleSession = async (nextSession: Session | null) => {
      if (!active) return;
      if (!nextSession) {
        handledUserId = null;
        setSession(null);
        setProfile(null);
        if (ignoreNextSignedOut) {
          ignoreNextSignedOut = false;
          return;
        }
        setStatus("signed-out");
        setMessage("");
        return;
      }

      if (handledUserId === nextSession.user.id) return;
      handledUserId = nextSession.user.id;
      setStatus("loading");
      try {
        await prepareProfile(nextSession);
      } catch (error) {
        if (!active) return;
        const blocked = /not allowlisted|row-level security|policy/i.test(error instanceof Error ? error.message : String(error));
        ignoreNextSignedOut = true;
        await supabase.auth.signOut();
        setMessage(friendlyAuthError(error));
        setStatus(blocked ? "blocked" : "error");
      }
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setMessage(friendlyAuthError(error));
        setStatus("error");
        return;
      }
      void handleSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => void handleSession(nextSession), 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [prepareProfile]);

  const signIn = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setStatus("loading");
    setMessage("");
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setMessage(friendlyAuthError(error));
      setStatus("error");
    }
  };

  const updateProfile = useCallback(async (update: ProfileUpdate) => {
    if (!profile) throw new Error("尚未登入");
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase 尚未設定");
    const displayName = update.displayName.trim().slice(0, 24);
    if (!displayName) throw new Error("請輸入顯示名稱");
    const avatarRecipe = normalizeAvatarRecipe(update.avatarRecipe);
    const { data, error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, avatar_recipe: avatarRecipe })
      .eq("id", profile.id)
      .select("id, email, display_name, avatar_recipe, is_admin")
      .single<ProfileRow>();
    if (error) throw error;
    setProfile(toProfile(data));
  }, [profile]);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const contextValue = useMemo<AuthContextValue | null>(() => {
    if (!session || !profile) return null;
    return { session, profile, updateProfile, signOut };
  }, [profile, session, signOut, updateProfile]);

  if (status === "ready" && contextValue) {
    return (
      <AuthContext.Provider value={contextValue}>
        {children}
        <MotionPreferenceNotice />
      </AuthContext.Provider>
    );
  }

  const isLoading = status === "loading";
  return (
    <main className="auth-gate">
      <section className="auth-card" aria-labelledby="auth-title" aria-busy={isLoading}>
        <div className="auth-table-scene" aria-hidden="true">
          <span className="auth-spark auth-spark--one">✦</span>
          <span className="auth-spark auth-spark--two">✦</span>
          <div className="auth-cloche"><i /></div>
          <div className="auth-table-line" />
        </div>

        <div className="auth-copy">
          <p className="eyebrow">PRIVATE TASTING TABLE</p>
          <h1 id="auth-title">登入今晚的餐桌</h1>
          <p>使用 Google 登入，和朋友一起記下每道菜真正好不好吃。</p>
        </div>

        {message && <p className={`auth-message ${status === "blocked" ? "auth-message--blocked" : ""}`} role="alert">{message}</p>}

        <button className="google-sign-in" type="button" onClick={() => void signIn()} disabled={isLoading}>
          {isLoading ? (
            <span className="auth-spinner" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.74 2.98-4.31 2.98-7.41Z" />
              <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.04.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.39 13.93A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z" />
              <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
            </svg>
          )}
          <span>{isLoading ? "正在確認帳號…" : "使用 Google 登入"}</span>
        </button>

        <p className="auth-footnote">僅限受邀朋友 · 不提供匿名訪客</p>
      </section>
    </main>
  );
}
