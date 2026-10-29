const MINUTE_MS = 60_000;

interface DurationFormatter {
  format(parts: { days: number; hours: number; minutes: number }): string;
}
type DurationFormatCtor = new (locale: string, opts: { style: string }) => DurationFormatter;

function findFormatter(): DurationFormatter | undefined {
  const ctor: unknown = Reflect.get(Intl, "DurationFormat");
  if (typeof ctor !== "function") return undefined;
  return new (ctor as DurationFormatCtor)("en", { style: "narrow" });
}

const formatter = findFormatter();

function formatByHand(days: number, hours: number, minutes: number): string {
  const units: [number, string][] = [
    [days, "d"],
    [hours, "h"],
    [minutes, "m"],
  ];
  const first = units.findIndex(([n]) => n > 0);
  return units
    .slice(first, first + 2)
    .filter(([n]) => n > 0)
    .map(([n, u]) => `${n}${u}`)
    .join(" ");
}

/** Whole minutes as "<1m", "12m", "3h 5m", "3h", "1d 2h" or "2d". Negative or NaN counts as 0. */
export function formatDuration(ms: number): string {
  const total = Math.floor((Number.isFinite(ms) && ms > 0 ? ms : 0) / MINUTE_MS);
  if (total === 0) return "<1m";
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  // At most two units: minutes are dropped once days are shown.
  const parts = days > 0 ? { days, hours, minutes: 0 } : { days: 0, hours, minutes };
  if (formatter === undefined) return formatByHand(parts.days, parts.hours, parts.minutes);
  return formatter.format(parts);
}
