export const SEARCH_MAX_AGE_DAYS = 3;
export const SEARCH_MAX_AGE_MS = SEARCH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export type JobTime = {
  /** Source event time, not the time this application scraped or saved the job. */
  sourceUpdatedAt?: string;
  sourceTimeText?: string;
  sourceTimeKind?: "updated" | "published";
};

function chinaDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(utc);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
    hour > 23 || minute > 59 || second > 59) return NaN;
  return utc - 8 * 3600_000;
}

export function jobTime(raw: unknown, kind: "updated" | "published", now = Date.now()): JobTime {
  if (typeof raw !== "string" || !raw.trim()) return {};
  const text = raw.trim();
  const value = text.replace(/^(?:更新时间|发布时间|更新于|发布于)\s*[:：]?\s*/, "")
    .replace(/\s*(?:更新|发布)$/, "").trim();
  let ms = NaN;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    ms = Number.isFinite(chinaDate(year, month, day)) ? Date.parse(value) : NaN;
  } else {
    const full = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const short = value.match(/^(\d{1,2})月(\d{1,2})日$/) ?? value.match(/^(\d{1,2})-(\d{1,2})$/);
    const relative = value.match(/^(\d+)\s*(分钟|小时|天)前$/);
    const local = new Date(now + 8 * 3600_000);
    if (full) ms = chinaDate(+full[1], +full[2], +full[3], +(full[4] ?? 0), +(full[5] ?? 0), +(full[6] ?? 0));
    else if (short) {
      ms = chinaDate(local.getUTCFullYear(), +short[1], +short[2]);
      if (ms > now) ms = chinaDate(local.getUTCFullYear() - 1, +short[1], +short[2]);
    } else if (relative) {
      // Displayed relative ages are rounded: use the earliest possible instant.
      const unit = relative[2] === "天" ? 86400_000 : relative[2] === "小时" ? 3600_000 : 60_000;
      ms = now - (+relative[1] + 1) * unit;
    } else if (/^(今天|今日|昨天|昨日|前天)$/.test(value)) {
      const days = /^(昨天|昨日)$/.test(value) ? 1 : value === "前天" ? 2 : 0;
      ms = chinaDate(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()) - days * 86400_000;
    } else if (value === "刚刚") ms = now - 60_000;
  }
  return {
    sourceUpdatedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : undefined,
    sourceTimeText: text,
    sourceTimeKind: kind,
  };
}

export function freshness(job: JobTime, now = Date.now()): "recent" | "old" | "unknown" {
  const time = job.sourceUpdatedAt ? Date.parse(job.sourceUpdatedAt) : NaN;
  if (!Number.isFinite(time) || time > now) return "unknown";
  return time >= now - SEARCH_MAX_AGE_MS ? "recent" : "old";
}
