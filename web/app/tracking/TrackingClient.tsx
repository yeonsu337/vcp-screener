"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLivePrices, fmtLiveTime } from "../lib/useLivePrices";
import {
  buildExport,
  computeDrawdown,
  computeReturn,
  computeStatus,
  daysBetween,
  parseImport,
  useTracking,
  type TrackingEntry,
  type TrackStatus,
} from "../lib/useTracking";

type SortKey =
  | "ticker"
  | "added_date"
  | "days"
  | "entry"
  | "current"
  | "return"
  | "max_return"
  | "drawdown";

const STATUS_STYLES: Record<TrackStatus, string> = {
  ON_TRACK: "bg-emerald-500/20 text-emerald-400",
  EARLY_WARNING: "bg-yellow-500/20 text-yellow-400",
  CRITICAL: "bg-red-500/20 text-red-400",
  EXITED: "bg-border text-muted",
};

const STATUS_LABEL: Record<TrackStatus, string> = {
  ON_TRACK: "On Track",
  EARLY_WARNING: "Warning",
  CRITICAL: "Critical",
  EXITED: "Exited",
};

function fmtPct(v: number, digits = 1): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function pctClass(v: number) {
  if (v > 0.5) return "text-emerald-400";
  if (v < -0.5) return "text-red-400";
  return "text-muted";
}

export default function TrackingClient() {
  const {
    list,
    hydrated,
    remove,
    exit,
    reactivate,
    updateHighs,
    clearAll,
    merge,
    replaceAll,
  } = useTracking();
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const tickers = useMemo(
    () => list.filter((e) => !e.exited).map((e) => e.ticker),
    [list],
  );
  const { quotes, asOf, loading } = useLivePrices(tickers, {
    enabled: tickers.length > 0,
  });

  const [sortKey, setSortKey] = useState<SortKey>("return");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Update high_since_add as live prices come in.
  useEffect(() => {
    const newHighs: Record<string, number> = {};
    for (const e of list) {
      if (e.exited) continue;
      const q = quotes[e.ticker];
      if (q?.price != null && q.price > e.high_since_add) {
        newHighs[e.ticker] = q.price;
      }
    }
    if (Object.keys(newHighs).length > 0) updateHighs(newHighs);
  }, [quotes, list, updateHighs]);

  type Row = TrackingEntry & {
    current: number;
    is_live: boolean;
    ret: number;
    max_ret: number;
    drawdown: number;
    days: number;
    status: TrackStatus;
  };

  const today = new Date().toISOString().slice(0, 10);

  const rows: Row[] = useMemo(() => {
    return list.map((e) => {
      const q = quotes[e.ticker];
      const live = q?.price ?? null;
      const current = e.exited
        ? e.exit_price ?? e.entry_price
        : live ?? e.high_since_add ?? e.entry_price;
      const high = Math.max(e.high_since_add, current);
      const ret = computeReturn(e.entry_price, current);
      const max_ret = computeReturn(e.entry_price, high);
      const drawdown = computeDrawdown(high, current);
      const days = e.exited
        ? daysBetween(e.added_date, e.exit_date ?? today)
        : daysBetween(e.added_date, today);
      const daysHeld = e.exited
        ? daysBetween(e.added_date, e.exit_date ?? today)
        : daysBetween(e.added_date, today);
      const status = computeStatus(ret, drawdown, !!e.exited, daysHeld);
      return {
        ...e,
        current,
        is_live: live != null && !e.exited,
        ret,
        max_ret,
        drawdown,
        days,
        status,
      };
    });
  }, [list, quotes, today]);

  const sortedActive = useMemo(() => {
    const active = rows.filter((r) => !r.exited);
    return [...active].sort((a, b) => cmp(a, b, sortKey, sortDir));
  }, [rows, sortKey, sortDir]);

  const sortedExited = useMemo(() => {
    const exited = rows.filter((r) => r.exited);
    return [...exited].sort((a, b) => {
      const da = a.exit_date ?? "";
      const db = b.exit_date ?? "";
      return db.localeCompare(da);
    });
  }, [rows]);

  // Summary stats (active only)
  const activeCount = sortedActive.length;
  const exitedCount = sortedExited.length;
  const winners = sortedActive.filter((r) => r.ret > 0).length;
  const hitRate =
    activeCount > 0 ? ((winners / activeCount) * 100).toFixed(1) : "—";
  const avgReturn =
    activeCount > 0
      ? (sortedActive.reduce((s, r) => s + r.ret, 0) / activeCount).toFixed(2)
      : "—";
  const bestReturn =
    activeCount > 0 ? Math.max(...sortedActive.map((r) => r.ret)) : 0;
  const worstReturn =
    activeCount > 0 ? Math.min(...sortedActive.map((r) => r.ret)) : 0;

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "ticker" || k === "added_date" ? "asc" : "desc");
    }
  }

  function exportJson() {
    const payload = buildExport(list);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tracking-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(mode: "merge" | "replace") {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const raw = await file.text();
      const parsed = parseImport(raw);
      if (!parsed.ok) {
        setImportMsg(`Import failed: ${parsed.reason}`);
        setTimeout(() => setImportMsg(null), 4000);
        return;
      }
      if (mode === "replace") {
        if (
          !confirm(
            `Replace ${list.length} existing entries with ${parsed.entries.length} from file? This cannot be undone.`,
          )
        ) {
          return;
        }
        const r = replaceAll(parsed.entries);
        setImportMsg(`Replaced — ${r.imported} entries loaded`);
      } else {
        const r = merge(parsed.entries);
        setImportMsg(
          `Merged — ${r.imported} new, ${r.merged} updated`,
        );
      }
      setTimeout(() => setImportMsg(null), 4000);
    };
    input.click();
  }

  function exportCsv() {
    const header = [
      "ticker",
      "company",
      "market",
      "added_date",
      "days_held",
      "entry_price",
      "current_price",
      "high_since_add",
      "return_pct",
      "max_return_pct",
      "drawdown_from_high_pct",
      "exited",
      "exit_date",
      "exit_price",
      "exit_reason",
    ];
    const lines = [header.join(",")];
    for (const r of [...sortedActive, ...sortedExited]) {
      lines.push(
        [
          r.ticker,
          quote(r.company ?? ""),
          r.market ?? "",
          r.added_date,
          r.days,
          r.entry_price.toFixed(4),
          r.current.toFixed(4),
          r.high_since_add.toFixed(4),
          r.ret.toFixed(2),
          r.max_ret.toFixed(2),
          r.drawdown.toFixed(2),
          r.exited ? "Y" : "N",
          r.exit_date ?? "",
          r.exit_price?.toFixed(4) ?? "",
          quote(r.exit_reason ?? ""),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tracking-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!hydrated) {
    return (
      <div className="card p-8 text-center text-muted text-sm">
        Loading tracking list…
      </div>
    );
  }

  return (
    <>
      {/* Summary */}
      <section className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
        <div className="card p-3">
          <div className="text-xs text-muted">Active</div>
          <div className="text-2xl font-bold num text-accent">{activeCount}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Exited</div>
          <div className="text-2xl font-bold num">{exitedCount}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Hit Rate</div>
          <div className="text-2xl font-bold num">{hitRate}%</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Avg Return</div>
          <div
            className={`text-2xl font-bold num ${
              Number(avgReturn) >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {avgReturn === "—" ? "—" : `${avgReturn}%`}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Best</div>
          <div className="text-2xl font-bold num text-emerald-400">
            {activeCount > 0 ? `+${bestReturn.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-muted">Worst</div>
          <div className="text-2xl font-bold num text-red-400">
            {activeCount > 0 ? `${worstReturn.toFixed(1)}%` : "—"}
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs text-muted">
          Stored locally in your browser (localStorage). Clearing site data
          will reset the list.
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/search"
            className="text-[11px] px-3 py-1.5 rounded border border-border text-muted hover:text-accent hover:border-accent/40 transition"
          >
            + Add via Search
          </Link>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="text-[11px] px-3 py-1.5 rounded border border-border text-muted hover:text-accent hover:border-accent/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Export CSV
          </button>
          <button
            onClick={exportJson}
            disabled={rows.length === 0}
            title="다른 기기로 옮기려면 JSON 내보내기 → 그 기기에서 Import"
            className="text-[11px] px-3 py-1.5 rounded border border-border text-muted hover:text-accent hover:border-accent/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Export JSON
          </button>
          <button
            onClick={() => importJson("merge")}
            title="기존 항목과 병합 — 같은 ticker는 가장 이른 added_date + 최대 high_since_add 유지"
            className="text-[11px] px-3 py-1.5 rounded border border-border text-muted hover:text-accent hover:border-accent/40 transition"
          >
            Import (Merge)
          </button>
          <button
            onClick={() => importJson("replace")}
            title="기존 목록 전부 교체"
            className="text-[11px] px-3 py-1.5 rounded border border-border text-muted hover:text-red-400 hover:border-red-400/40 transition"
          >
            Import (Replace)
          </button>
          {rows.length > 0 && (
            <ConfirmButton
              label="Clear All"
              confirmLabel="Click to confirm"
              onConfirm={clearAll}
              danger
            />
          )}
        </div>
      </div>
      {importMsg && (
        <div className="mb-3 text-[11px] px-3 py-2 rounded border border-accent/30 bg-accent/10 text-accent">
          {importMsg}
        </div>
      )}

      {/* Live indicator */}
      {tickers.length > 0 && (
        <div className="mb-3 flex items-center justify-end text-[11px] text-muted gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              loading ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"
            }`}
          />
          <span>
            {loading ? "Refreshing" : "Live"} · Price as of {fmtLiveTime(asOf)}
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          <p className="mb-3">
            No tracked tickers yet.
          </p>
          <p className="text-xs">
            Open a candidate in the{" "}
            <Link href="/screener" className="text-accent hover:underline">
              Screener
            </Link>
            {" "}or{" "}
            <Link href="/search" className="text-accent hover:underline">
              Search
            </Link>
            {" "}any ticker, then click{" "}
            <span className="text-accent font-semibold">+ Add to Tracking</span>.
          </p>
        </div>
      ) : (
        <>
          {/* Active table */}
          {sortedActive.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mt-2 mb-2">
                Active ({sortedActive.length})
              </h2>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3 mb-6">
                {sortedActive.map((r) => (
                  <MobileCard
                    key={`a-${r.ticker}`}
                    r={r}
                    onRemove={() => remove(r.ticker)}
                    onExit={() => exit(r.ticker, r.current, "manual")}
                  />
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block card overflow-hidden mb-6">
                <table className="w-full text-sm">
                  <thead className="bg-border/30 text-muted text-xs uppercase">
                    <tr>
                      <Th label="Status" />
                      <Th label="Mkt" />
                      <ThSort
                        label="Ticker"
                        k="ticker"
                        cur={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                      />
                      <Th label="Company" />
                      <ThSort
                        label="Added"
                        k="added_date"
                        cur={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        align="right"
                      />
                      <ThSort
                        label="Days"
                        k="days"
                        cur={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        align="right"
                      />
                      <ThSort
                        label="Entry"
                        k="entry"
                        cur={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        align="right"
                      />
                      <ThSort
                        label="Current"
                        k="current"
                        cur={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        align="right"
                      />
                      <ThSort
                        label="Return"
                        k="return"
                        cur={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        align="right"
                      />
                      <ThSort
                        label="Max"
                        k="max_return"
                        cur={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        align="right"
                      />
                      <ThSort
                        label="Drawdown"
                        k="drawdown"
                        cur={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        align="right"
                      />
                      <Th label="" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedActive.map((r) => (
                      <tr
                        key={`a-${r.ticker}`}
                        className="border-t border-border hover:bg-border/20"
                      >
                        <td className="px-3 py-2">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${STATUS_STYLES[r.status]}`}
                          >
                            {STATUS_LABEL[r.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">
                          {r.market ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-bold">
                          <Link
                            href={`/screener/${encodeURIComponent(r.ticker)}`}
                            className="hover:text-accent"
                          >
                            {r.ticker}
                          </Link>
                        </td>
                        <td className="px-3 py-2 truncate max-w-[160px] text-xs">
                          {r.company ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right num text-muted text-xs">
                          {r.added_date}
                        </td>
                        <td className="px-3 py-2 text-right num">{r.days}</td>
                        <td className="px-3 py-2 text-right num">
                          {r.entry_price.toFixed(2)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right num ${r.is_live ? "" : "text-muted"}`}
                          title={r.is_live ? "Live price" : "Last known"}
                        >
                          {r.current.toFixed(2)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right num font-semibold ${pctClass(r.ret)}`}
                        >
                          {fmtPct(r.ret)}
                        </td>
                        <td className="px-3 py-2 text-right num text-emerald-400/80 text-xs">
                          {fmtPct(r.max_ret)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right num ${pctClass(r.drawdown)}`}
                        >
                          {fmtPct(r.drawdown)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <RowActions
                            onExit={() => exit(r.ticker, r.current, "manual")}
                            onRemove={() => remove(r.ticker)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Exited (frozen) */}
          {sortedExited.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mt-4 mb-2">
                Exited ({sortedExited.length}) · frozen at exit price
              </h2>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3 mb-6">
                {sortedExited.map((r) => (
                  <MobileCard
                    key={`x-${r.ticker}-${r.exit_date}`}
                    r={r}
                    exited
                    onRemove={() => reactivate(r.ticker)}
                  />
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-border/30 text-muted text-xs uppercase">
                    <tr>
                      <Th label="Mkt" />
                      <Th label="Ticker" />
                      <Th label="Company" />
                      <Th label="Added" align="right" />
                      <Th label="Exit Date" align="right" />
                      <Th label="Days" align="right" />
                      <Th label="Entry" align="right" />
                      <Th label="Exit" align="right" />
                      <Th label="Return" align="right" />
                      <Th label="Reason" />
                      <Th label="" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedExited.map((r) => (
                      <tr
                        key={`x-${r.ticker}-${r.exit_date}`}
                        className="border-t border-border hover:bg-border/20 opacity-80"
                      >
                        <td className="px-3 py-2 text-xs text-muted">
                          {r.market ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-bold">
                          <Link
                            href={`/screener/${encodeURIComponent(r.ticker)}`}
                            className="hover:text-accent"
                          >
                            {r.ticker}
                          </Link>
                        </td>
                        <td className="px-3 py-2 truncate max-w-[160px] text-xs">
                          {r.company ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right num text-muted text-xs">
                          {r.added_date}
                        </td>
                        <td className="px-3 py-2 text-right num text-muted text-xs">
                          {r.exit_date ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right num">{r.days}</td>
                        <td className="px-3 py-2 text-right num">
                          {r.entry_price.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right num">
                          {(r.exit_price ?? 0).toFixed(2)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right num font-semibold ${pctClass(r.ret)}`}
                        >
                          {fmtPct(r.ret)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">
                          {r.exit_reason ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ConfirmButton
                            label="Delete"
                            confirmLabel="Confirm"
                            onConfirm={() => reactivate(r.ticker)}
                            danger
                            tiny
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------

function quote(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function cmp<T extends { [K in SortKey]?: unknown }>(
  a: { ticker: string; added_date: string; days: number; entry_price: number; current: number; ret: number; max_ret: number; drawdown: number },
  b: { ticker: string; added_date: string; days: number; entry_price: number; current: number; ret: number; max_ret: number; drawdown: number },
  k: SortKey,
  dir: "asc" | "desc",
): number {
  let av: number | string;
  let bv: number | string;
  switch (k) {
    case "ticker":
      av = a.ticker;
      bv = b.ticker;
      break;
    case "added_date":
      av = a.added_date;
      bv = b.added_date;
      break;
    case "days":
      av = a.days;
      bv = b.days;
      break;
    case "entry":
      av = a.entry_price;
      bv = b.entry_price;
      break;
    case "current":
      av = a.current;
      bv = b.current;
      break;
    case "return":
      av = a.ret;
      bv = b.ret;
      break;
    case "max_return":
      av = a.max_ret;
      bv = b.max_ret;
      break;
    case "drawdown":
      av = a.drawdown;
      bv = b.drawdown;
      break;
  }
  let r = 0;
  if (typeof av === "number" && typeof bv === "number") r = av - bv;
  else r = String(av).localeCompare(String(bv));
  return dir === "asc" ? r : -r;
}

function Th({ label, align }: { label: string; align?: "right" }) {
  return (
    <th className={`${align === "right" ? "text-right" : "text-left"} px-3 py-2`}>
      {label}
    </th>
  );
}

function ThSort({
  label,
  k,
  cur,
  dir,
  onClick,
  align,
}: {
  label: string;
  k: SortKey;
  cur: SortKey;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  align?: "right";
}) {
  const active = cur === k;
  const arrow = active ? (dir === "asc" ? "▲" : "▼") : "";
  return (
    <th className={`${align === "right" ? "text-right" : "text-left"} px-3 py-2`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`uppercase tracking-wide hover:text-accent transition ${active ? "text-accent" : ""}`}
      >
        {label} <span className="text-[8px]">{arrow}</span>
      </button>
    </th>
  );
}

function RowActions({
  onExit,
  onRemove,
}: {
  onExit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <ConfirmButton
        label="Exit"
        confirmLabel="Confirm"
        onConfirm={onExit}
        tiny
      />
      <ConfirmButton
        label="Remove"
        confirmLabel="Confirm"
        onConfirm={onRemove}
        danger
        tiny
      />
    </div>
  );
}

function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  danger,
  tiny,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
  tiny?: boolean;
}) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const id = setTimeout(() => setArm(false), 2500);
    return () => clearTimeout(id);
  }, [arm]);
  const base = tiny
    ? "text-[10px] px-2 py-0.5 rounded border transition"
    : "text-[11px] px-3 py-1.5 rounded border transition";
  const cls = arm
    ? "border-red-500/60 text-red-400 bg-red-500/10"
    : danger
      ? "border-border text-muted hover:text-red-400 hover:border-red-400/40"
      : "border-border text-muted hover:text-accent hover:border-accent/40";
  return (
    <button
      type="button"
      onClick={() => {
        if (arm) {
          onConfirm();
          setArm(false);
        } else {
          setArm(true);
        }
      }}
      className={`${base} ${cls}`}
    >
      {arm ? confirmLabel : label}
    </button>
  );
}

function MobileCard({
  r,
  exited,
  onRemove,
  onExit,
}: {
  r: {
    ticker: string;
    company?: string;
    market?: string;
    added_date: string;
    entry_price: number;
    current: number;
    ret: number;
    max_ret: number;
    drawdown: number;
    days: number;
    is_live?: boolean;
    status?: TrackStatus;
    exit_date?: string;
    exit_price?: number;
    exit_reason?: string;
  };
  exited?: boolean;
  onRemove: () => void;
  onExit?: () => void;
}) {
  return (
    <div className={`card p-4 ${exited ? "opacity-80" : ""}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <Link
            href={`/screener/${encodeURIComponent(r.ticker)}`}
            className="font-bold text-lg hover:text-accent"
          >
            {r.ticker}
          </Link>
          <div className="text-xs text-muted">{r.company ?? ""}</div>
        </div>
        <div className="text-right">
          <div
            className={`text-lg font-bold num ${pctClass(r.ret)}`}
          >
            {fmtPct(r.ret)}
          </div>
          <div className="text-xs text-muted">{r.days}d</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
        <div>
          <div className="text-muted">Added</div>
          <div className="num">{r.added_date}</div>
        </div>
        <div>
          <div className="text-muted">Entry</div>
          <div className="num">{r.entry_price.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-muted">{exited ? "Exit" : "Current"}</div>
          <div className={`num ${r.is_live ? "" : "text-muted"}`}>
            {r.current.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
        <div>
          <span className="text-muted">Max: </span>
          <span className="text-emerald-400/80 num">{fmtPct(r.max_ret)}</span>
        </div>
        <div>
          <span className="text-muted">DD from high: </span>
          <span className={`num ${pctClass(r.drawdown)}`}>
            {fmtPct(r.drawdown)}
          </span>
        </div>
      </div>
      {exited ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">
            Exited {r.exit_date ?? "—"}
            {r.exit_reason ? ` · ${r.exit_reason}` : ""}
          </span>
          <ConfirmButton
            label="Delete"
            confirmLabel="Confirm"
            onConfirm={onRemove}
            danger
            tiny
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {r.status && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${STATUS_STYLES[r.status]}`}
            >
              {STATUS_LABEL[r.status]}
            </span>
          )}
          <span className="ml-auto inline-flex gap-1">
            {onExit && (
              <ConfirmButton
                label="Exit"
                confirmLabel="Confirm"
                onConfirm={onExit}
                tiny
              />
            )}
            <ConfirmButton
              label="Remove"
              confirmLabel="Confirm"
              onConfirm={onRemove}
              danger
              tiny
            />
          </span>
        </div>
      )}
    </div>
  );
}
