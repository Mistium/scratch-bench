export const fmtSpeedup = (x: number | null | undefined): string => {
  if (x == null || !Number.isFinite(x)) return "–";
  if (x >= 100) return `${Math.round(x).toLocaleString("en-US")}×`;
  if (x >= 10) return `${x.toFixed(1)}×`;
  return `${x.toFixed(2)}×`;
};

export const fmtOps = (x: number | null | undefined): string => {
  if (x == null || !Number.isFinite(x)) return "–";
  const abs = Math.abs(x);
  if (abs >= 1e9) return `${(x / 1e9).toPrecision(3)}G`;
  if (abs >= 1e6) return `${(x / 1e6).toPrecision(3)}M`;
  if (abs >= 1e4) return `${(x / 1e3).toPrecision(3)}k`;
  if (abs >= 100) return Math.round(x).toLocaleString("en-US");
  return Number(x.toPrecision(3)).toString();
};

export const fmtPercent = (x: number | null | undefined, digits = 1): string =>
  x == null || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(digits)}%`;

export const fmtMs = (x: number | null | undefined): string => {
  if (x == null || !Number.isFinite(x)) return "–";
  return x >= 1000
    ? `${(x / 1000).toFixed(2)} s`
    : `${x >= 100 ? Math.round(x) : x.toFixed(1)} ms`;
};

export const fmtMb = (x: number | null | undefined): string =>
  x == null || !Number.isFinite(x) ? "–" : `${Math.round(x)} MB`;

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

export const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : `${
    d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    })
  } ${d.toISOString().slice(11, 16)} UTC`;
};

export const fmtAgo = (
  iso: string | null | undefined,
  now = Date.now(),
): string => {
  if (!iso) return "never";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600 * 1.5) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

export const change = (
  now: number | null | undefined,
  before: number | null | undefined,
): number | null =>
  now != null && before != null && before > 0 ? now / before - 1 : null;

export const fmtChange = (c: number | null): string =>
  c == null
    ? "–"
    : `${c >= 0 ? "+" : ""}${(c * 100).toFixed(Math.abs(c) < 0.1 ? 1 : 0)}%`;
