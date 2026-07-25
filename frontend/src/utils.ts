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

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const hourLabel = (h: number) => {
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${period}`;
};

// "Today 5 PM" / "Tomorrow 5 PM" / "Jul 18, 5 PM" — replaces the old "Yarin" cron.
export function formatDeadline(deadlineAt: string, deadlineHour: number): string {
  const d = new Date(deadlineAt);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const time = hourLabel(deadlineHour);
  if (sameDay(d, now)) return `Today ${time}`;
  if (sameDay(d, tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

// Deadline urgency for row styling: past = overdue, today = due.
export function deadlineState(deadlineAt: string, status: string): "overdue" | "due" | "ok" {
  if (status === "CANCELLED" || status === "FULFILLED") return "ok";
  const d = new Date(deadlineAt);
  const now = new Date();
  if (d.getTime() < now.getTime()) return "overdue";
  if (sameDay(d, now)) return "due";
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
