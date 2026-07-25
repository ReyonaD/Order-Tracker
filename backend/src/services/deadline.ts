import { DateTime } from "luxon";

// Port of calculateDeadline() from the original Apps Script, but producing a REAL
// timestamp instead of a "5 PM" / "Yarin 5 PM" string. The frontend derives the
// "Today / Tomorrow X PM" label from this timestamp, so the nightly cron that
// stripped "Yarin" is no longer needed.
//
// Rule:
//   - cutoff hour comes from the store (pickup vs shipping).
//   - If the order's LOCAL time is past the cutoff, the deadline rolls to next day.
//   - Deadline is always 5 PM (today / tomorrow). (The old 7 PM option was removed.)

export interface DeadlineInput {
  orderDate: Date;
  timezone: string;
  cutoffHour: number; // pickupCutoffHour or shippingCutoffHour depending on isPickup
  isPickup: boolean;
  shippingMethod: string;
}

export interface DeadlineOutput {
  deadlineAt: Date;
  deadlineHour: number; // always 17 ("5 PM")
}

export function calculateDeadline(input: DeadlineInput): DeadlineOutput {
  const { orderDate, timezone, cutoffHour } = input;

  const local = DateTime.fromJSDate(orderDate, { zone: timezone });

  // Everyone targets 5 PM now.
  const targetHour = 17;

  // Past the cutoff => roll to the next day (matches "hours > cutoff || (== cutoff && min > 0)").
  const afterCutoff =
    local.hour > cutoffHour || (local.hour === cutoffHour && local.minute > 0);

  const deadlineDay = afterCutoff ? local.plus({ days: 1 }) : local;

  const deadlineAt = deadlineDay
    .set({ hour: targetHour, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();

  return { deadlineAt, deadlineHour: targetHour };
}
