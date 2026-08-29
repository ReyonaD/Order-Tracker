// Item type -> text color (mirrors the Apps Script determineItemTypes colors).
const ITEM_COLORS: Record<string, string> = {
  "T-shirt": "#FF9900",
  "Gang Sheet": "#0000FF",
  UV: "#009999",
  Sample: "#996633",
  "Color Chart": "#556B2F",
};

export function itemColor(types: string[]): string | undefined {
  return types.length === 1 ? ITEM_COLORS[types[0]] : undefined;
}

// Deadlines are always shown in the business timezone (Texas / Central), so a
// viewer in India sees the exact same "Today/Tomorrow" as one in Texas — the
// day is never computed from the browser's local timezone.
const BUSINESS_TZ = "America/Chicago";

// Calendar date (YYYY-MM-DD) of an instant, in the business timezone.
function ymdInTz(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });
}
// Shift a YYYY-MM-DD string by n calendar days.
function shiftYmd(ymd: string, n: number): string {
  const [y, m, day] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

const hourLabel = (h: number) => {
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${period}`;
};

// "Today 5 PM" / "Tomorrow 5 PM" / "Jul 18, 5 PM" — replaces the old "Yarin" cron.
export function formatDeadline(deadlineAt: string, deadlineHour: number): string {
  const dYmd = ymdInTz(new Date(deadlineAt));
  const nowYmd = ymdInTz(new Date());

  const time = hourLabel(deadlineHour);
  if (dYmd === nowYmd) return `Today ${time}`;
  if (dYmd === shiftYmd(nowYmd, 1)) return `Tomorrow ${time}`;
  return `${new Date(deadlineAt).toLocaleDateString("en-US", { timeZone: BUSINESS_TZ, month: "short", day: "numeric" })} ${time}`;
}

// Deadline urgency for row styling: past = overdue, today = due.
export function deadlineState(deadlineAt: string, status: string): "overdue" | "due" | "ok" {
  if (status === "CANCELLED" || status === "FULFILLED") return "ok";
  const d = new Date(deadlineAt);
  const now = new Date();
  if (d.getTime() < now.getTime()) return "overdue";
  if (ymdInTz(d) === ymdInTz(now)) return "due";
  return "ok";
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
