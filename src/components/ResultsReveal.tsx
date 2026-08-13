import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowClockwise,
  ArrowLeft,
  CaretRight,
  ForkKnife,
  House,
  Medal,
  Sparkle,
  UsersThree,
} from "@phosphor-icons/react";
import { Avatar } from "./Avatar";
import { BottomSheet } from "./BottomSheet";
import { DishVisual } from "./DishVisual";
import { buildDemoHistoryLeaderboard, podiumGroups, rankVisitDishes } from "../lib/results";
import { prefersReducedMotion } from "../lib/motionPreference";
import { loadRestaurantDishLeaderboard, loadRestaurantOverallHistory } from "../lib/resultRepository";
import type {
  HistoricalDishResult,
  HistoricalOverallResult,
  Participant,
  ResultRankGroup,
  VisitDishResult,
  VisitResultSnapshot,
} from "../types";

interface ResultsGateProps {
  participants: Participant[];
  readyParticipantIds?: ReadonlySet<string>;
  canReveal?: boolean;
  demo?: boolean;
  onReveal: () => void;
  onBack: () => void;
}

interface ResultsRevealProps {
  snapshot: VisitResultSnapshot;
  participants: Participant[];
  restaurantId?: string;
  historical?: boolean;
  initiallyComplete?: boolean;
  demo?: boolean;
  onViewed: () => void;
  onReplay: () => void;
  onBack: () => void;
  onHome: () => void;
}

type RevealPhase = "closed" | "revealing" | "complete";
type DetailSheetState =
  | { kind: "dish"; result: VisitDishResult }
  | { kind: "group"; group: ResultRankGroup }
  | null;

function formatAverage(result: Pick<VisitDishResult, "average" | "ratingCount">) {
  return result.ratingCount === 1 ? String(Math.round(result.average)) : result.average.toFixed(1);
}

function formatResultDate(value?: string) {
  if (!value) return "HISTORY";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "HISTORY";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function ResultDishArtwork({ result, compact = false }: { result: VisitDishResult; compact?: boolean }) {
  return (
    <span className={`result-dish-artwork result-dish-artwork--${result.dish.category}${compact ? " is-compact" : ""}`} aria-hidden="true">
      <span className="result-dish-plate" />
      <DishVisual recipe={result.dish.visualRecipe} variant="result" />
    </span>
  );
}

function groupForRank(groups: ResultRankGroup[], rank: number) {
  return groups.find((group) => group.rank === rank) ?? null;
}

function commonReasons(result: VisitDishResult | null, limit = 3) {
  if (!result) return [];
  const counts = new Map<string, number>();
  result.individualScores.forEach((rating) => rating.reasons.forEach((reason) => {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-TW"))
    .slice(0, limit)
    .map(([reason]) => reason);
}

function groupLabel(group: ResultRankGroup) {
  if (group.dishes.length === 1) return group.dishes[0].dish.name;
  if (group.dishes.length === 2) return `${group.dishes[0].dish.name}、${group.dishes[1].dish.name}並列`;
  return `${group.dishes[0].dish.name}等 ${group.dishes.length} 道並列`;
}

function DishDetail({ result, participants }: { result: VisitDishResult; participants: Participant[] }) {
  return (
    <div className="result-sheet-detail">
      <header>
        <ResultDishArtwork result={result} />
        <span>
          <small>{result.ratingCount} 人評分</small>
          <output>{formatAverage(result)}<b>/100</b></output>
        </span>
      </header>
      <div className="result-sheet-scores">
        {result.individualScores.map((score) => {
          const participant = participants.find((item) => item.id === score.participantId);
          if (!participant) return null;
          return (
            <article key={score.participantId}>
              <Avatar participant={participant} variant="bust" decorative />
              <span><strong>{score.name}</strong>{score.reasons.length > 0 && <small>{score.reasons.join(" · ")}</small>}</span>
              <b>{score.score}</b>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function HistoryPage({
  overallHistory,
  history,
  onBack,
}: {
  overallHistory: HistoricalOverallResult | null;
  history: HistoricalDishResult[];
  onBack: () => void;
}) {
  return (
    <main id="main" className="results-main" tabIndex={-1}>
      <section className="history-page" aria-labelledby="historyPageTitle">
        <button className="history-page-back" type="button" onClick={onBack}>
          <ArrowLeft weight="bold" /> 返回本次結果
        </button>
        <header>
          <p className="eyebrow">ALL-TIME · LUEUR</p>
          <h1 id="historyPageTitle">這間店的歷史</h1>
          <p>每個人的歷次評分先平均，再讓每位使用者等權計算。</p>
        </header>
        {overallHistory && (
          <section className="history-overall-summary" aria-label="店家歷史整體評價">
            <span><small className="eyebrow">RESTAURANT</small><strong>歷史整體評價</strong><small>{overallHistory.peopleCount} 人 · {overallHistory.visitCount} 次用餐</small></span>
            <output>{overallHistory.average.toFixed(1)}<b>/100</b></output>
          </section>
        )}
        <div className="history-page-section-heading">
          <p className="eyebrow">DISH LEADERBOARD</p>
          <h2>歷史菜色榜</h2>
        </div>
        <ol className="history-page-list">
          {history.map((dish, index) => (
            <li key={dish.dishId}>
              <b>{index + 1}</b>
              <span><strong>{dish.name}</strong><small>{dish.peopleCount} 人吃過 · 共 {dish.ratingCount} 次評分</small></span>
              <output>{dish.average.toFixed(1)}</output>
            </li>
          ))}
        </ol>
        <p className="history-page-note">近期品質變化先保留為未來功能。</p>
      </section>
    </main>
  );
}

export function ResultsGate({
  participants,
  readyParticipantIds = new Set(participants.map((participant) => participant.id)),
  canReveal = true,
  demo = false,
  onReveal,
  onBack,
}: ResultsGateProps) {
  const readyCount = participants.filter((participant) => readyParticipantIds.has(participant.id)).length;
  return (
    <main id="main" className="results-main" tabIndex={-1}>
      <section className="results-gate" aria-labelledby="resultsGateTitle">
        <p className="eyebrow">{demo ? "DEMO · READY" : "EVERYONE READY"}</p>
        <h1 id="resultsGateTitle">今晚的結果準備好了</h1>
        <div className="results-ready-party" aria-label={`${participants.length} 位成員已完成`}>
          {participants.slice(0, 7).map((participant) => (
            <span key={participant.id} className={`results-ready-person${readyParticipantIds.has(participant.id) ? " is-ready" : " is-waiting"}`}>
              <Avatar participant={participant} variant="bust" decorative />
            </span>
          ))}
          {participants.length > 7 && <span className="results-ready-overflow">+{participants.length - 7}</span>}
        </div>
        <p className="results-ready-progress" role="status">{canReveal ? "大家都完成了" : `${readyCount}/${participants.length} 人完成`}</p>
        <button className="results-reveal-cta" type="button" disabled={!canReveal} onClick={onReveal}>
          <Sparkle weight="fill" /> 揭曉今晚結果
        </button>
        <button className="results-gate-back" type="button" onClick={onBack}>回去檢查評分</button>
      </section>
    </main>
  );
}

export function ResultsReveal({
  snapshot,
  participants,
  restaurantId,
  historical = false,
  initiallyComplete = false,
  demo = false,
  onViewed,
  onReplay,
  onBack,
  onHome,
}: ResultsRevealProps) {
  const occasionLabel = historical ? "這次" : "今晚";
  const bestLabel = historical ? "本次最佳" : "今晚最佳";
  const resultEyebrow = historical
    ? `${formatResultDate(snapshot.revealedAt)} · HISTORY`
    : demo ? "DEMO · RESULTS" : "LUEUR · TONIGHT";
  const ranked = useMemo(() => rankVisitDishes(snapshot.dishes), [snapshot.dishes]);
  const groups = useMemo(() => podiumGroups(ranked), [ranked]);
  const demoHistory = useMemo(
    () => demo ? buildDemoHistoryLeaderboard(snapshot.dishes, participants) : [],
    [demo, participants, snapshot.dishes],
  );
  const demoOverallHistory = useMemo<HistoricalOverallResult | null>(() => (
    demo && snapshot.overall
      ? {
          average: snapshot.overall.average,
          peopleCount: snapshot.overall.ratingCount,
          visitCount: 1,
          ratingCount: snapshot.overall.ratingCount,
        }
      : null
  ), [demo, snapshot.overall]);
  const [history, setHistory] = useState<HistoricalDishResult[]>(demoHistory);
  const [overallHistory, setOverallHistory] = useState<HistoricalOverallResult | null>(demoOverallHistory);
  const hasCompetition = ranked.length >= 3;
  const [phase, setPhase] = useState<RevealPhase>(initiallyComplete || !hasCompetition ? "complete" : "closed");
  const [detailSheet, setDetailSheet] = useState<DetailSheetState>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  const viewedNotified = useRef(false);

  const winnerGroup = groupForRank(groups, 1);
  const secondGroup = groupForRank(groups, 2);
  const thirdGroup = groupForRank(groups, 3);
  const featuredIds = useMemo(() => new Set(groups.flatMap((group) => group.dishes.map((dish) => dish.dish.id))), [groups]);
  const otherResults = useMemo(() => ranked.filter((result) => !featuredIds.has(result.dish.id)), [featuredIds, ranked]);
  const winnerReasons = useMemo(() => {
    if (!winnerGroup) return [];
    return [...new Set(winnerGroup.dishes.flatMap((dish) => commonReasons(dish, 2)))].slice(0, 2);
  }, [winnerGroup]);

  const closeDetailSheet = useCallback(() => setDetailSheet(null), []);

  useEffect(() => {
    if (demo) {
      setHistory(demoHistory);
      setOverallHistory(demoOverallHistory);
      return;
    }
    if (!restaurantId) {
      setHistory([]);
      setOverallHistory(null);
      return;
    }

    let cancelled = false;
    void Promise.allSettled([
      loadRestaurantOverallHistory(restaurantId),
      loadRestaurantDishLeaderboard(restaurantId),
    ]).then(([overallResult, dishesResult]) => {
      if (cancelled) return;
      setOverallHistory(overallResult.status === "fulfilled" ? overallResult.value : null);
      setHistory(dishesResult.status === "fulfilled"
        ? dishesResult.value.map((row) => ({
            dishId: row.restaurantDishId,
            name: row.displayName,
            average: row.average,
            peopleCount: row.peopleCount,
            ratingCount: row.ratingCount,
          }))
        : []);
    });
    return () => { cancelled = true; };
  }, [demo, demoHistory, demoOverallHistory, restaurantId]);

  useEffect(() => {
    if (initiallyComplete || !hasCompetition) return;
    window.scrollTo({ top: 0, behavior: "auto" });
    if (prefersReducedMotion()) {
      setPhase("complete");
      return;
    }
    const openTimer = window.setTimeout(() => setPhase("revealing"), 80);
    const vibrationTimer = window.setTimeout(() => {
      if ("vibrate" in window.navigator) window.navigator.vibrate?.(35);
    }, 650);
    const finishTimer = window.setTimeout(() => setPhase("complete"), 1500);
    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(vibrationTimer);
      window.clearTimeout(finishTimer);
    };
  }, [hasCompetition, initiallyComplete]);

  useEffect(() => {
    if (phase !== "complete" || viewedNotified.current) return;
    viewedNotified.current = true;
    onViewed();
  }, [onViewed, phase]);

  if (historyVisible) return <HistoryPage overallHistory={overallHistory} history={history} onBack={() => setHistoryVisible(false)} />;

  const openGroup = (group: ResultRankGroup) => {
    setDetailSheet(group.dishes.length === 1 ? { kind: "dish", result: group.dishes[0] } : { kind: "group", group });
  };

  const renderRankRow = (rank: 2 | 3, group: ResultRankGroup | null) => (
    <button
      className={`curtain-rank-row curtain-rank-row--${rank}${group ? "" : " is-vacant"}`}
      type="button"
      disabled={!group || phase !== "complete"}
      aria-label={group ? `查看第 ${rank} 名 ${groupLabel(group)}的評分` : `第 ${rank} 名從缺`}
      onClick={() => group && openGroup(group)}
    >
      <b className="curtain-rank-number">{rank}</b>
      <span className="curtain-rank-art">
        {group?.dishes.slice(0, 2).map((dish) => <ResultDishArtwork key={dish.dish.id} result={dish} compact />)}
      </span>
      <span className="curtain-rank-copy">
        <strong>{group ? groupLabel(group) : "本次從缺"}</strong>
        <small>{group ? `${group.dishes[0].ratingCount} 人評分` : "未達 60 分"}</small>
      </span>
      {group && <output>{formatAverage(group.dishes[0])}</output>}
      {group && <CaretRight weight="bold" aria-hidden="true" />}
    </button>
  );

  return (
    <main id="main" className="results-main" tabIndex={-1}>
      <section className={`award-card reveal-${phase}${hasCompetition ? "" : " is-compact-result"}`} aria-labelledby="awardTitle">
        <header className="award-heading">
          <div>
            <p className="eyebrow">{resultEyebrow}</p>
            <h1 id="awardTitle">{hasCompetition ? `${occasionLabel}最好吃的是？` : `${occasionLabel}吃了什麼？`}</h1>
          </div>
          {hasCompetition && <span className="award-threshold"><Medal weight="duotone" /> 60 分入選</span>}
        </header>

        {hasCompetition ? (
          <div className="curtain-theater" aria-live="polite">
            <p className="sr-only">{phase === "complete" ? `${occasionLabel}結果已揭曉` : `正在揭曉${occasionLabel}結果`}</p>
            <div className="curtain-result-content" aria-hidden={phase !== "complete"}>
              <div className="winner-rays" aria-hidden="true" />
              <button
                className={`winner-hero${winnerGroup ? "" : " is-vacant"}`}
                type="button"
                disabled={!winnerGroup || phase !== "complete"}
                onClick={() => winnerGroup && openGroup(winnerGroup)}
              >
                <span className="winner-spark-field" aria-hidden="true"><i /><i /><i /><i /></span>
                {winnerGroup ? (
                  <>
                    <span className={`winner-art-stack${winnerGroup.dishes.length > 2 ? " has-many" : ""}`}>
                      {winnerGroup.dishes.length <= 2
                        ? winnerGroup.dishes.map((dish) => <ResultDishArtwork key={dish.dish.id} result={dish} />)
                        : <span className="winner-tie-count">{winnerGroup.dishes.length}<small>道並列</small></span>}
                    </span>
                    <span className="winner-copy">
                      <small>{bestLabel}</small>
                      <strong>{winnerGroup.dishes.length === 1 ? winnerGroup.dishes[0].dish.name : winnerGroup.dishes.length === 2 ? `並列${bestLabel}` : `${winnerGroup.dishes.length} 道並列第一`}</strong>
                      <output>{formatAverage(winnerGroup.dishes[0])}<b>/100</b></output>
                      <span>{winnerGroup.dishes[0].ratingCount} 人評分</span>
                    </span>
                    {winnerReasons.length > 0 && <span className="winner-reasons">{winnerReasons.map((reason) => <i key={reason}>{reason}</i>)}</span>}
                  </>
                ) : (
                  <>
                    <span className="vacant-plate" aria-hidden="true" />
                    <span className="winner-copy"><small>{bestLabel}</small><strong>本次從缺</strong><span>沒有料理跨過 60 分</span></span>
                  </>
                )}
              </button>
              <div className="curtain-rank-list">
                {renderRankRow(2, secondGroup)}
                {renderRankRow(3, thirdGroup)}
              </div>
              {winnerGroup && winnerGroup.dishes.length > 2 && (
                <div className="winner-tie-list" aria-label="並列第一名料理">
                  {winnerGroup.dishes.map((dish) => (
                    <button key={dish.dish.id} type="button" disabled={phase !== "complete"} onClick={() => setDetailSheet({ kind: "dish", result: dish })}>
                      <ResultDishArtwork result={dish} compact /><span>{dish.dish.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="theater-curtain theater-curtain--left" aria-hidden="true" />
            <span className="theater-curtain theater-curtain--right" aria-hidden="true" />
          </div>
        ) : (
          <div className="compact-result-intro">
            <ForkKnife weight="duotone" aria-hidden="true" />
            <strong>這次不進行料理排名</strong>
            <span>至少 3 道有效料理才會揭曉{historical ? "本次" : "今晚"}前三名。</span>
          </div>
        )}

        <div
          className={`results-summary-reveal${phase === "complete" ? " is-visible" : ""}`}
          aria-hidden={phase !== "complete"}
          inert={phase !== "complete"}
        >
          <div className="results-summary">
            <section className={`ranking-section${hasCompetition && phase === "complete" ? " ranking-section--arrival" : ""}`} aria-labelledby="rankingTitle">
              <div className="results-section-heading">
                <div><p className="eyebrow">{hasCompetition ? "MORE DISHES" : "DISHES"}</p><h2 id="rankingTitle">{hasCompetition ? "其他料理" : "本次料理"}</h2></div>
                <small>{ranked.length} 道有效料理</small>
              </div>
              <ol className="result-ranking-list result-ranking-list--compact">
                {(hasCompetition ? otherResults : ranked).map((result, index) => (
                  <li key={result.dish.id} style={{ "--result-delay": `${120 + Math.min(index, 8) * 65}ms` } as CSSProperties}>
                    <button className="result-ranking-row" type="button" onClick={() => setDetailSheet({ kind: "dish", result })}>
                      <b className="result-rank-number">{hasCompetition ? result.rank : "—"}</b>
                      <span className="result-rank-copy"><strong>{result.dish.name}</strong><small>{result.average < 60 ? `未入選 · ${result.ratingCount} 人評分` : `${result.ratingCount} 人評分`}</small></span>
                      <output>{formatAverage(result)}</output>
                      <CaretRight weight="bold" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            </section>

            {snapshot.overall && (
              <button className="overall-result-card" type="button" onClick={() => setDetailSheet({ kind: "dish", result: snapshot.overall! })}>
                <span className="overall-result-icon" aria-hidden="true"><ForkKnife weight="duotone" /></span>
                <span className="overall-result-copy">
                  <small className="eyebrow">TOTAL · VISIT</small>
                  <strong>{historical ? "這次整體用餐" : "今晚整體用餐"}</strong>
                  <small>{commonReasons(snapshot.overall, 2).join(" · ") || `${snapshot.overall.ratingCount} 人留下評價`}</small>
                </span>
                <output>{formatAverage(snapshot.overall)}<span>/100</span></output>
                <CaretRight weight="bold" aria-hidden="true" />
              </button>
            )}

            {(overallHistory || history[0]) && (
              <button className="history-entry-card history-entry-card--split" type="button" onClick={() => setHistoryVisible(true)}>
                <span className="history-entry-overall">
                  <small className="eyebrow">店家歷史</small>
                  <strong>{overallHistory ? <>{overallHistory.average.toFixed(1)}<b>/100</b></> : "尚無整體評價"}</strong>
                  <small>{overallHistory ? `${overallHistory.peopleCount} 人 · ${overallHistory.visitCount} 次用餐` : "完成整體評分後建立"}</small>
                </span>
                <i className="history-entry-divider" aria-hidden="true" />
                <span className="history-entry-dishes">
                  <small className="eyebrow">歷史菜色榜</small>
                  <strong>{history[0] ? <><b>1</b>{history[0].name}</> : "尚無菜色紀錄"}</strong>
                  <small>{history[0] ? `${history[0].average.toFixed(1)} 分 · ${history[0].peopleCount} 人` : "評完料理後建立"}</small>
                </span>
                <CaretRight weight="bold" aria-hidden="true" />
              </button>
            )}

            <div className="result-actions">
              {hasCompetition && <button type="button" onClick={onReplay}><ArrowClockwise weight="bold" /> 重播揭曉</button>}
              <button type="button" onClick={onHome}><House weight="bold" /> 回到餐廳</button>
            </div>
            {demo && <button className="result-demo-back" type="button" onClick={onBack}>結束結果預覽</button>}
            <p className="result-privacy-note"><UsersThree weight="duotone" /> 封測版會在揭曉後顯示姓名與個人分數。</p>
          </div>
        </div>
      </section>

      <BottomSheet
        open={detailSheet !== null}
        title={detailSheet?.kind === "dish" ? detailSheet.result.dish.name : detailSheet?.kind === "group" ? `並列第 ${detailSheet.group.rank} 名` : "評分明細"}
        eyebrow={detailSheet?.kind === "group" ? `${detailSheet.group.dishes.length} 道料理同分` : "SCORE DETAILS"}
        onClose={closeDetailSheet}
      >
        {detailSheet?.kind === "dish" && <DishDetail result={detailSheet.result} participants={participants} />}
        {detailSheet?.kind === "group" && (
          <div className="result-tie-picker">
            <p>選一道料理查看每個人的分數與詞條。</p>
            {detailSheet.group.dishes.map((dish) => (
              <button key={dish.dish.id} type="button" onClick={() => setDetailSheet({ kind: "dish", result: dish })}>
                <ResultDishArtwork result={dish} compact />
                <span><strong>{dish.dish.name}</strong><small>{dish.ratingCount} 人評分</small></span>
                <output>{formatAverage(dish)}</output>
                <CaretRight weight="bold" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </BottomSheet>
    </main>
  );
}
