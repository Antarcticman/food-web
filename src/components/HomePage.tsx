import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle,
  ClockCounterClockwise,
  ForkKnife,
  LinkSimple,
  MagnifyingGlass,
  MapPin,
  NavigationArrow,
  Plus,
  SpinnerGap,
  UsersThree,
} from "@phosphor-icons/react";
import { useAuth } from "./AuthGate";
import { Avatar } from "./Avatar";
import { BottomSheet } from "./BottomSheet";
import { ProfileEditorSheet } from "./ProfileEditorSheet";
import {
  activeVisitParticipantToAvatar,
  createActiveVisit,
  isLikelyDuplicate,
  joinActiveVisit,
  listActiveVisits,
  listRecentVisits,
  listRestaurantCatalog,
  restaurantSearchRadius,
  resolveGoogleMapsLink,
  suggestRestaurants,
  subscribeToActiveVisits,
  type ActiveVisit,
  type RestaurantCatalogEntry,
  type RestaurantSearchLocation,
  type RestaurantSuggestion,
  type ResolvedMapPlace,
} from "../lib/activeVisitRepository";

interface HomePageProps {
  onOpenVisit: (visit: ActiveVisit) => void;
}

type LoadState = "loading" | "ready" | "error";
type LocationState = "idle" | "locating" | "ready" | "denied" | "error";
type MapLinkState = "idle" | "resolving" | "ready" | "error";

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown };
    if (typeof value.message === "string" && value.message) {
      const details = typeof value.details === "string" ? value.details : "";
      return [value.message, details].filter(Boolean).join(" · ");
    }
  }
  return fallback;
}

function visitTime(iso: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function visitDate(iso: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(iso));
}

function roomMeta(visit: ActiveVisit) {
  const people = `${visit.participants.length} 位朋友`;
  const dishes = visit.dishCount ? `${visit.dishCount} 道菜` : "菜單共編中";
  return `${people} · ${dishes}`;
}

function distanceLabel(distance: number | null) {
  if (distance == null) return null;
  if (distance < 1_000) return `${distance}m`;
  return `${(distance / 1_000).toFixed(distance < 10_000 ? 1 : 0)}km`;
}

function suggestionHistory(restaurant: RestaurantSuggestion) {
  const parts: string[] = [];
  if (restaurant.currentUserVisitCount > 0) parts.push(`你吃過 ${restaurant.currentUserVisitCount} 次`);
  if (restaurant.visitorNames.length > 0) {
    const names = restaurant.visitorNames.slice(0, 2).join("、");
    const more = restaurant.visitorNames.length > 2 ? `等 ${restaurant.visitorNames.length} 人` : "";
    parts.push(`${names}${more}吃過`);
  }
  if (!parts.length && restaurant.visitCount > 0) parts.push(`朋友來過 ${restaurant.visitCount} 次`);
  return parts.join(" · ") || "還沒有用餐紀錄";
}

function isPossiblyStale(visit: ActiveVisit) {
  return Date.now() - new Date(visit.createdAt).getTime() >= 6 * 60 * 60 * 1000;
}

export function HomePage({ onOpenVisit }: HomePageProps) {
  const { profile } = useAuth();
  const [visits, setVisits] = useState<ActiveVisit[]>([]);
  const [recentVisits, setRecentVisits] = useState<ActiveVisit[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadMessage, setLoadMessage] = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinMessage, setJoinMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [restaurantName, setRestaurantName] = useState("");
  const [debouncedRestaurantName, setDebouncedRestaurantName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [address, setAddress] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [mapLinkState, setMapLinkState] = useState<MapLinkState>("idle");
  const [mapLinkMessage, setMapLinkMessage] = useState("");
  const [resolvedMapPlace, setResolvedMapPlace] = useState<ResolvedMapPlace | null>(null);
  const [restaurantCatalog, setRestaurantCatalog] = useState<RestaurantCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantSuggestion | null>(null);
  const [selectedAlias, setSelectedAlias] = useState("");
  const [creatingNewRestaurant, setCreatingNewRestaurant] = useState(false);
  const [coordinates, setCoordinates] = useState<RestaurantSearchLocation | null>(null);
  const [saveLocation, setSaveLocation] = useState(true);
  const [locationState, setLocationState] = useState<LocationState>("idle");
  const [locationMessage, setLocationMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const profilePrompted = useRef(false);
  const refreshTimer = useRef<number | null>(null);
  const locationDenied = useRef(false);

  const currentParticipant = useMemo(() => ({
    id: profile.id,
    name: profile.displayName,
    color: profile.avatarRecipe.background ?? "#E5A28D",
    avatar: profile.avatarRecipe,
  }), [profile.avatarRecipe, profile.displayName, profile.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedRestaurantName(restaurantName), 180);
    return () => window.clearTimeout(timer);
  }, [restaurantName]);

  const restaurantSuggestions = useMemo(() => suggestRestaurants(
    restaurantCatalog,
    debouncedRestaurantName,
    coordinates,
  ), [coordinates, debouncedRestaurantName, restaurantCatalog]);

  const likelyDuplicate = useMemo(() => (
    isLikelyDuplicate(debouncedRestaurantName, restaurantSuggestions[0])
      ? restaurantSuggestions[0]
      : null
  ), [debouncedRestaurantName, restaurantSuggestions]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const catalog = await listRestaurantCatalog(profile.id);
      setRestaurantCatalog(catalog);
      return catalog;
    } catch (error) {
      setCreateMessage(errorMessage(error, "暫時讀不到餐廳紀錄"));
      return null;
    } finally {
      setCatalogLoading(false);
    }
  }, [profile.id]);

  const loadVisits = useCallback(async (quiet = false) => {
    if (!quiet) setLoadState("loading");
    try {
      const [next, recent] = await Promise.all([
        listActiveVisits(profile.id),
        listRecentVisits(profile.id),
      ]);
      setVisits(next);
      setRecentVisits(recent);
      setLoadMessage("");
      setLoadState("ready");
      return next;
    } catch (error) {
      setLoadMessage(errorMessage(error, "暫時讀不到進行中的餐桌"));
      setLoadState("error");
      return null;
    }
  }, [profile.id]);

  useEffect(() => {
    void loadVisits();
    const unsubscribe = subscribeToActiveVisits(() => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void loadVisits(true), 120);
    });
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      unsubscribe();
    };
  }, [loadVisits]);

  useEffect(() => {
    if (profile.avatarConfigured || profilePrompted.current) return;
    profilePrompted.current = true;
    setProfileOpen(true);
  }, [profile.avatarConfigured]);

  const openRoom = async (visit: ActiveVisit) => {
    if (joiningId) return;
    if (visit.status !== "active") {
      onOpenVisit(visit);
      return;
    }
    setJoiningId(visit.id);
    setJoinMessage("");
    try {
      await joinActiveVisit(visit.id, profile.id);
      const refreshed = await loadVisits(true);
      const selected = refreshed?.find((item) => item.id === visit.id) ?? {
        ...visit,
        joined: true,
        participants: visit.participants.some((participant) => participant.userId === profile.id)
          ? visit.participants
          : [...visit.participants, {
            userId: profile.id,
            joinedAt: new Date().toISOString(),
            completed: false,
            name: profile.displayName,
            avatarRecipe: profile.avatarRecipe,
          }],
      };
      onOpenVisit(selected);
    } catch (error) {
      setJoinMessage(errorMessage(error, "加入失敗，請再試一次"));
    } finally {
      setJoiningId(null);
    }
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    if (!selectedRestaurant && !creatingNewRestaurant) {
      setCreateMessage("請先選擇一間餐廳，或確認要建立新餐廳。");
      return;
    }
    setCreating(true);
    setCreateMessage("");
    try {
      const resolvedCoordinates = resolvedMapPlace?.latitude != null && resolvedMapPlace.longitude != null
        ? { latitude: resolvedMapPlace.latitude, longitude: resolvedMapPlace.longitude, accuracy: 20 }
        : null;
      const savedCoordinates = resolvedCoordinates ?? coordinates;
      const visitId = await createActiveVisit({
        restaurantId: selectedRestaurant?.id,
        restaurantName: selectedRestaurant?.name ?? restaurantName,
        branchName: selectedRestaurant?.branchName ?? branchName,
        address: selectedRestaurant?.address ?? address,
        latitude: savedCoordinates?.latitude,
        longitude: savedCoordinates?.longitude,
        locationAccuracy: savedCoordinates?.accuracy,
        mapUrl,
        mapExternalId: resolvedMapPlace?.externalId ?? undefined,
        saveLocation: Boolean(savedCoordinates && saveLocation && (
          creatingNewRestaurant
          || (selectedRestaurant?.latitude == null && selectedRestaurant?.longitude == null)
        )),
        requestedAlias: selectedRestaurant ? selectedAlias : undefined,
        userId: profile.id,
      });
      const refreshed = await loadVisits(true);
      const visit = refreshed?.find((item) => item.id === visitId);
      if (!visit) throw new Error("餐桌已建立，但暫時讀不到資料，請回主頁重試。");
      setCreateOpen(false);
      setRestaurantName("");
      setDebouncedRestaurantName("");
      setBranchName("");
      setAddress("");
      setMapUrl("");
      setMapLinkState("idle");
      setMapLinkMessage("");
      setResolvedMapPlace(null);
      setSelectedRestaurant(null);
      setSelectedAlias("");
      setCreatingNewRestaurant(false);
      setCoordinates(null);
      setLocationState("idle");
      setLocationMessage("");
      void loadCatalog();
      onOpenVisit(visit);
    } catch (error) {
      setCreateMessage(errorMessage(error, "建立失敗，請再試一次"));
    } finally {
      setCreating(false);
    }
  };

  const locateRestaurants = (force = false) => {
    if (locationDenied.current && !force) return;
    if (!window.navigator.geolocation) {
      setLocationState("error");
      setLocationMessage("這個瀏覽器不支援定位，仍可直接輸入店名。");
      return;
    }
    setLocationState("locating");
    setLocationMessage("");
    setCoordinates(null);
    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        locationDenied.current = false;
        const nextCoordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setCoordinates(nextCoordinates);
        setSaveLocation(true);
        setLocationState("ready");
        setLocationMessage(`定位精度約 ${Math.round(position.coords.accuracy)}m · 搜尋 ${restaurantSearchRadius(position.coords.accuracy)}m 內的紀錄`);
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        locationDenied.current = denied;
        setLocationState(denied ? "denied" : "error");
        setLocationMessage(denied
          ? "定位未開啟；你仍可搜尋店名，之後也能從這裡重試。"
          : "暫時抓不到位置；你仍可直接搜尋店名。");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const openCreateSheet = () => {
    setCreateOpen(true);
    setCreateMessage("");
    void loadCatalog();
    locateRestaurants();
  };

  const chooseRestaurant = (restaurant: RestaurantSuggestion) => {
    setSelectedAlias(restaurantName.trim());
    setSelectedRestaurant(restaurant);
    setCreatingNewRestaurant(false);
    setSaveLocation(restaurant.latitude == null && restaurant.longitude == null);
    setCreateMessage("");
  };

  const chooseNewRestaurant = () => {
    if (!restaurantName.trim()) return;
    setSelectedRestaurant(null);
    setCreatingNewRestaurant(true);
    setSaveLocation(Boolean(coordinates));
    setCreateMessage("");
  };

  const resetRestaurantChoice = () => {
    setSelectedRestaurant(null);
    setCreatingNewRestaurant(false);
    setSelectedAlias("");
  };

  const applyResolvedPlace = useCallback((place: ResolvedMapPlace) => {
    const placeLocation = place.latitude != null && place.longitude != null
      ? { latitude: place.latitude, longitude: place.longitude, accuracy: 20 }
      : coordinates;
    const normalizedAddress = (value: string | null | undefined) => (value ?? "")
      .replace(/[\s,，、.-]/g, "")
      .replace(/臺/g, "台")
      .toLocaleLowerCase("zh-TW");
    const addressMatch = place.address
      ? restaurantCatalog.find((restaurant) => (
        normalizedAddress(restaurant.address) === normalizedAddress(place.address)
      ))
      : undefined;
    const addressSuggestion = addressMatch
      ? { ...addressMatch, distanceMeters: null, matchScore: 1 } satisfies RestaurantSuggestion
      : undefined;
    const bestMatch = addressSuggestion ?? suggestRestaurants(restaurantCatalog, place.name, placeLocation, 1)[0];
    setRestaurantName(place.name);
    setDebouncedRestaurantName(place.name);
    setAddress(place.address ?? "");
    setSelectedAlias(place.name);
    setCreateMessage("");
    setSaveLocation(Boolean(placeLocation));
    if (addressSuggestion || isLikelyDuplicate(place.name, bestMatch)) {
      setSelectedRestaurant(bestMatch);
      setCreatingNewRestaurant(false);
    } else {
      setSelectedRestaurant(null);
      setCreatingNewRestaurant(true);
    }
  }, [coordinates, restaurantCatalog]);

  useEffect(() => {
    const value = mapUrl.trim();
    if (!createOpen || !value || !/^https:\/\/(?:maps\.app\.goo\.gl|goo\.gl|maps\.google\.com|(?:www\.)?google\.com)\//i.test(value)) {
      if (!value) {
        setMapLinkState("idle");
        setMapLinkMessage("");
        setResolvedMapPlace(null);
      }
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setMapLinkState("resolving");
      setMapLinkMessage("正在讀取店家資訊…");
      void resolveGoogleMapsLink(value)
        .then((place) => {
          if (cancelled) return;
          setResolvedMapPlace(place);
          setMapLinkState("ready");
          setMapLinkMessage(place.address ?? "已從 Google 地圖帶入店名");
          applyResolvedPlace(place);
        })
        .catch((error) => {
          if (cancelled) return;
          setResolvedMapPlace(null);
          setMapLinkState("error");
          const message = errorMessage(error, "");
          setMapLinkMessage(message.includes("Edge Function")
            ? "暫時讀不到連結；仍可直接輸入店名。"
            : message || "讀不到這個連結，仍可直接輸入店名。");
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyResolvedPlace, createOpen, mapUrl]);

  const closeCreateSheet = () => {
    if (creating) return;
    setCreateOpen(false);
    setRestaurantName("");
    setDebouncedRestaurantName("");
    setBranchName("");
    setAddress("");
    setMapUrl("");
    setMapLinkState("idle");
    setMapLinkMessage("");
    setResolvedMapPlace(null);
    resetRestaurantChoice();
    setCreateMessage("");
  };

  const clearResolvedMapPlace = () => {
    setMapUrl("");
    setMapLinkState("idle");
    setMapLinkMessage("");
    setResolvedMapPlace(null);
    setRestaurantName("");
    setDebouncedRestaurantName("");
    setBranchName("");
    setAddress("");
    resetRestaurantChoice();
  };

  const hasResolvedMapPlace = mapLinkState === "ready" && Boolean(resolvedMapPlace);

  return (
    <>
      <a className="skip-link" href="#home-main">跳到進行中的餐桌</a>
      <div className="home-shell">
        <header className="home-topbar">
          <div className="home-wordmark">
            <strong>Lueur</strong>
            <small>和朋友記住真正好吃的</small>
          </div>
          <button
            className="profile-button home-profile-button"
            type="button"
            aria-label={`編輯 ${profile.displayName} 的個人資料`}
            onClick={() => setProfileOpen(true)}
          >
            <Avatar participant={currentParticipant} variant="profile" decorative />
            <i aria-hidden="true" />
          </button>
        </header>

        <main id="home-main" className="home-main" tabIndex={-1}>
          <section className="home-hero" aria-labelledby="home-title">
            <p className="eyebrow">FRIENDS' TABLE</p>
            <h1 id="home-title">現在要去哪桌？</h1>
            <p>進行中的餐桌會出現在這裡。朋友已經開桌的話，點一下就能直接加入。</p>
          </section>

          <section className="active-room-section" aria-labelledby="active-room-title" aria-busy={loadState === "loading"}>
            <header className="home-section-heading">
              <div>
                <p className="eyebrow">LIVE NOW</p>
                <h2 id="active-room-title">正在吃</h2>
              </div>
              {loadState === "ready" && visits.length > 0 && <span>{visits.length} 桌</span>}
            </header>

            {loadState === "loading" ? (
              <div className="room-loading" role="status">
                <SpinnerGap weight="bold" aria-hidden="true" />
                <span>看看朋友在哪一桌…</span>
              </div>
            ) : loadState === "error" ? (
              <div className="room-state-card room-state-card--error" role="alert">
                <strong>暫時連不上餐桌</strong>
                <p>{loadMessage}</p>
                <button type="button" onClick={() => void loadVisits()}>再試一次</button>
              </div>
            ) : visits.length === 0 ? (
              <div className="room-state-card">
                <span className="room-empty-icon" aria-hidden="true"><ForkKnife weight="bold" /></span>
                <strong>現在還沒有進行中的餐桌</strong>
                <p>你可以直接開第一桌，朋友登入後就會在主頁看到。</p>
                <button className="home-primary-action" type="button" onClick={openCreateSheet}>
                  <Plus weight="bold" aria-hidden="true" />
                  <span>開始一桌</span>
                </button>
              </div>
            ) : (
              <div className="active-room-list">
                {visits.map((visit) => {
                  const visible = visit.participants.slice(0, 5);
                  const overflow = Math.max(visit.participants.length - visible.length, 0);
                  const joining = joiningId === visit.id;
                  return (
                    <button
                      key={visit.id}
                      className="active-room-card"
                      type="button"
                      aria-label={`${visit.joined ? "回到" : "加入"}${visit.restaurantName}的餐桌，${roomMeta(visit)}`}
                      aria-busy={joining}
                      disabled={Boolean(joiningId)}
                      onClick={() => void openRoom(visit)}
                    >
                      <span className="active-room-copy">
                        <span className={`active-room-status${isPossiblyStale(visit) ? " is-stale" : ""}`}>
                          <i aria-hidden="true" />
                          {isPossiblyStale(visit) ? "可能已結束" : "正在用餐"}
                        </span>
                        <strong>{visit.restaurantName}</strong>
                        {(visit.branchName || visit.address) && (
                          <small className="active-room-location">
                            <MapPin weight="fill" aria-hidden="true" />
                            <span>{[visit.branchName, visit.address].filter(Boolean).join(" · ")}</span>
                          </small>
                        )}
                        <small className="active-room-meta">{roomMeta(visit)} · {visitTime(visit.createdAt)} 開桌</small>
                      </span>

                      <span className="active-room-side">
                        <span className="active-room-avatars" aria-hidden="true">
                          {visible.map((participant) => (
                            <span key={participant.userId} className="active-room-avatar" style={{ "--avatar-bg": participant.avatarRecipe.background ?? "#D8CDBE" } as CSSProperties}>
                              <Avatar participant={activeVisitParticipantToAvatar(participant, profile.id)} variant="bust" decorative />
                            </span>
                          ))}
                          {overflow > 0 && <b>+{overflow}</b>}
                        </span>
                        <span className="active-room-enter">
                          {joining ? <SpinnerGap className="is-spinning" weight="bold" aria-hidden="true" /> : <ArrowRight weight="bold" aria-hidden="true" />}
                          <em>{joining ? "加入中" : visit.joined ? "繼續" : "直接加入"}</em>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {joinMessage && <p className="home-inline-error" role="alert">{joinMessage}</p>}
          </section>

          {loadState === "ready" && recentVisits.length > 0 && (
            <section className="recent-visit-section" aria-labelledby="recent-visit-title">
              <header className="home-section-heading">
                <div>
                  <p className="eyebrow">RECENT TABLES</p>
                  <h2 id="recent-visit-title">最近吃過</h2>
                </div>
              </header>
              <div className="recent-visit-list">
                {recentVisits.map((visit) => (
                  <button key={visit.id} className="recent-visit-card" type="button" onClick={() => void openRoom(visit)}>
                    <span className="recent-visit-icon" aria-hidden="true"><ClockCounterClockwise weight="duotone" /></span>
                    <span>
                      <strong>{visit.restaurantName}</strong>
                      <small>{[visit.branchName, `${visitDate(visit.createdAt)} · ${visit.dishCount} 道料理`].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="recent-visit-open">看結果 <ArrowRight weight="bold" aria-hidden="true" /></span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {visits.length > 0 && (
            <button className="start-table-button" type="button" onClick={openCreateSheet}>
              <Plus weight="bold" aria-hidden="true" />
              <span>開始另一桌</span>
            </button>
          )}

          <p className="home-access-note">
            <UsersThree weight="bold" aria-hidden="true" />
            <span>封測期間只有好友名單內的 Google 帳號看得到這些餐桌。</span>
          </p>
        </main>
      </div>

      <BottomSheet open={createOpen} title="開始一桌" eyebrow="NEW TABLE" className="create-visit-sheet" onClose={closeCreateSheet}>
        <form className="create-visit-form" onSubmit={submitCreate}>
          <div className={`restaurant-location-status is-${locationState}`} role="status">
            <span className="restaurant-location-icon" aria-hidden="true">
              {locationState === "locating" ? <SpinnerGap className="is-spinning" weight="bold" /> : <NavigationArrow weight="fill" />}
            </span>
            <span>
              <strong>{locationState === "ready" ? "已取得目前位置" : locationState === "locating" ? "正在找附近紀錄" : "位置可幫你分辨分店"}</strong>
              <small>{locationMessage || "只在開桌時使用；不會持續追蹤。"}</small>
            </span>
            {locationState !== "locating" && (
              <button type="button" onClick={() => {
                locationDenied.current = false;
                locateRestaurants(true);
              }}>
                {locationState === "ready" ? "更新" : "重試"}
              </button>
            )}
          </div>

          <label className={`restaurant-map-link is-${mapLinkState}`}>
            <span><LinkSimple weight="bold" aria-hidden="true" />Google 地圖分享連結 <small>貼一個就好</small></span>
            <span className="restaurant-map-link-input">
              <input
                type="url"
                value={mapUrl}
                maxLength={1200}
                inputMode="url"
                autoComplete="off"
                placeholder="https://maps.app.goo.gl/…"
                onChange={(event) => {
                  setMapUrl(event.target.value);
                  setMapLinkState("idle");
                  setMapLinkMessage("");
                  setResolvedMapPlace(null);
                  resetRestaurantChoice();
                }}
              />
              {mapLinkState === "resolving" && <SpinnerGap className="is-spinning" weight="bold" aria-hidden="true" />}
              {mapLinkState === "ready" && <CheckCircle weight="fill" aria-hidden="true" />}
            </span>
            {(mapLinkMessage || resolvedMapPlace) && (
              <small className="restaurant-map-link-feedback" role={mapLinkState === "error" ? "alert" : "status"}>
                {mapLinkState === "ready" && resolvedMapPlace ? <strong>{resolvedMapPlace.name}</strong> : null}
                <span>{mapLinkMessage}</span>
              </small>
            )}
          </label>

          {!hasResolvedMapPlace && <>
            <div className="restaurant-input-divider"><span>或輸入店名</span></div>

            <label className="restaurant-search-field">
            <span>你現在在哪間店？</span>
            <span className="restaurant-search-input">
              <MagnifyingGlass weight="bold" aria-hidden="true" />
              <input
                type="search"
                value={restaurantName}
                maxLength={160}
                autoComplete="off"
                enterKeyHint="search"
                placeholder="輸入店名或你記得的簡稱"
                onChange={(event) => {
                  setRestaurantName(event.target.value);
                  resetRestaurantChoice();
                }}
              />
            </span>
            </label>

            {!selectedRestaurant && !creatingNewRestaurant && (
            <section className="restaurant-suggestion-section" aria-live="polite" aria-busy={catalogLoading}>
              <header>
                <strong>{restaurantName.trim() ? "符合店名" : coordinates ? "你附近的紀錄" : "最近開過的店"}</strong>
                {coordinates && !restaurantName.trim() && <small>{restaurantSearchRadius(coordinates.accuracy)}m 內</small>}
              </header>

              {catalogLoading && restaurantCatalog.length === 0 ? (
                <div className="restaurant-search-loading"><SpinnerGap className="is-spinning" weight="bold" />讀取餐廳紀錄…</div>
              ) : restaurantSuggestions.length > 0 ? (
                <div className="restaurant-suggestion-list">
                  {restaurantSuggestions.map((restaurant, index) => (
                    <button
                      key={restaurant.id}
                      type="button"
                      className={likelyDuplicate?.id === restaurant.id ? "is-likely" : ""}
                      onClick={() => chooseRestaurant(restaurant)}
                    >
                      <span className="restaurant-suggestion-main">
                        <span>
                          <strong>{restaurant.name}</strong>
                          {likelyDuplicate?.id === restaurant.id && index === 0 && <em>可能就是這間</em>}
                          {restaurant.activeVisitId && <em className="is-live">正在用餐</em>}
                        </span>
                        <small>{[restaurant.branchName, restaurant.address].filter(Boolean).join(" · ") || "未填分店或地址"}</small>
                        <small>{suggestionHistory(restaurant)}</small>
                      </span>
                      <span className="restaurant-suggestion-distance">
                        {distanceLabel(restaurant.distanceMeters) && <b>{distanceLabel(restaurant.distanceMeters)}</b>}
                        <ArrowRight weight="bold" aria-hidden="true" />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="restaurant-search-empty">
                  <MapPin weight="duotone" aria-hidden="true" />
                  <span>{restaurantName.trim() ? "好友紀錄裡沒有相近店名" : locationState === "locating" ? "定位完成後會顯示附近紀錄" : "目前沒有可推薦的餐廳"}</span>
                </div>
              )}

              {restaurantName.trim() && (
                <button
                  className={`restaurant-create-new${likelyDuplicate ? " is-cautious" : ""}`}
                  type="button"
                  onClick={chooseNewRestaurant}
                >
                  <Plus weight="bold" aria-hidden="true" />
                  <span>{likelyDuplicate ? `確定不同，建立「${restaurantName.trim()}」` : `建立「${restaurantName.trim()}」新餐廳`}</span>
                </button>
              )}
            </section>
            )}
          </>}

          {selectedRestaurant && (
            <section className="restaurant-confirm-card">
              <header>
                <span aria-hidden="true"><CheckCircle weight="fill" /></span>
                <div>
                  <small>確認開桌餐廳</small>
                  <strong>{selectedRestaurant.name}</strong>
                </div>
                <button type="button" onClick={hasResolvedMapPlace ? clearResolvedMapPlace : resetRestaurantChoice}>更換</button>
              </header>
              {(selectedRestaurant.branchName || selectedRestaurant.address) && (
                <p><MapPin weight="fill" aria-hidden="true" />{[selectedRestaurant.branchName, selectedRestaurant.address].filter(Boolean).join(" · ")}</p>
              )}
              <p>{suggestionHistory(selectedRestaurant)}{distanceLabel(selectedRestaurant.distanceMeters) ? ` · 距離 ${distanceLabel(selectedRestaurant.distanceMeters)}` : ""}</p>
              {selectedRestaurant.activeVisitId && (
                <div className="restaurant-live-note"><UsersThree weight="fill" aria-hidden="true" />這間店已經有一桌，會直接加入，不會重複開桌。</div>
              )}
              {!hasResolvedMapPlace && coordinates && selectedRestaurant.latitude == null && selectedRestaurant.longitude == null && (
                <label className="restaurant-save-location">
                  <input type="checkbox" checked={saveLocation} onChange={(event) => setSaveLocation(event.target.checked)} />
                  <span><strong>補上這間店的位置</strong><small>之後朋友在附近就找得到 · 精度約 {Math.round(coordinates.accuracy)}m</small></span>
                </label>
              )}
            </section>
          )}

          {creatingNewRestaurant && hasResolvedMapPlace && resolvedMapPlace && (
            <section className="restaurant-confirm-card is-from-map">
              <header>
                <span aria-hidden="true"><CheckCircle weight="fill" /></span>
                <div>
                  <small>Google 地圖已確認</small>
                  <strong>{resolvedMapPlace.name}</strong>
                </div>
                <button type="button" onClick={clearResolvedMapPlace}>更換</button>
              </header>
              {resolvedMapPlace.address && <p><MapPin weight="fill" aria-hidden="true" />{resolvedMapPlace.address}</p>}
              <p>會直接用這筆店名與地址建立餐廳，不需要再填一次。</p>
            </section>
          )}

          {creatingNewRestaurant && !hasResolvedMapPlace && (
            <section className="restaurant-new-card">
              <header>
                <div><small>建立新的餐廳紀錄</small><strong>{restaurantName.trim()}</strong></div>
                <button type="button" onClick={resetRestaurantChoice}>返回搜尋</button>
              </header>
              <label>
                <span>分店或地點 <small>選填</small></span>
                <input type="text" value={branchName} maxLength={160} placeholder="例如：信義店" onChange={(event) => setBranchName(event.target.value)} />
              </label>
              {coordinates && (
                <label className="restaurant-save-location">
                  <input type="checkbox" checked={saveLocation} onChange={(event) => setSaveLocation(event.target.checked)} />
                  <span><strong>儲存目前位置</strong><small>預設勾選 · 精度約 {Math.round(coordinates.accuracy)}m</small></span>
                </label>
              )}
              <details className="restaurant-extra-details">
                <summary>補充或修正地址</summary>
                <label>
                  <span>地址 <small>選填</small></span>
                  <input type="text" value={address} maxLength={300} autoComplete="street-address" placeholder="貼上或輸入地址" onChange={(event) => setAddress(event.target.value)} />
                </label>
              </details>
            </section>
          )}

          <p className="create-visit-privacy">建立後好友會直接在主頁看到；封測版不需要房間碼。</p>
          {createMessage && <p className="create-visit-error" role="alert">{createMessage}</p>}
          <button className="create-visit-submit" type="submit" disabled={creating || (!selectedRestaurant && !creatingNewRestaurant)}>
            {creating ? <SpinnerGap className="is-spinning" weight="bold" aria-hidden="true" /> : selectedRestaurant?.activeVisitId ? <UsersThree weight="fill" aria-hidden="true" /> : <Plus weight="bold" aria-hidden="true" />}
            <span>{creating ? "正在處理…" : selectedRestaurant?.activeVisitId ? "加入這桌" : selectedRestaurant ? "在這間開桌" : creatingNewRestaurant ? "建立餐廳並開桌" : "先選擇餐廳"}</span>
          </button>
        </form>
      </BottomSheet>

      <ProfileEditorSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSaved={() => void loadVisits(true)}
      />
    </>
  );
}
