import { describe, expect, it } from "vitest";
import {
  formatWaitingExactTime,
  formatWaitingMinutes,
  pickOldestWaitingConversation,
  sortWaitingOldestFirst
} from "./inboxHelpers";

describe("formatWaitingMinutes", () => {
  it("formats minutes and hours", () => {
    expect(formatWaitingMinutes(12)).toBe("12 د");
    expect(formatWaitingMinutes(90)).toBe("1 س 30 د");
    expect(formatWaitingMinutes(120)).toBe("2 س");
  });

  it("uses days for long waits", () => {
    expect(formatWaitingMinutes(1440)).toBe("1 ي");
    expect(formatWaitingMinutes(1500)).toBe("1 ي 1 س");
    expect(formatWaitingMinutes(2880)).toBe("2 ي");
  });
});

describe("waiting order helpers", () => {
  it("picks the oldest waiting conversation by waiting_minutes", () => {
    const oldest = pickOldestWaitingConversation([
      { id: "a", waiting_minutes: 10, last_inbound_at: "2026-11-25T10:00:00Z" },
      { id: "b", waiting_minutes: 4000, last_inbound_at: "2026-11-22T10:00:00Z" },
      { id: "c", waiting_minutes: 90, last_inbound_at: "2026-11-25T08:00:00Z" }
    ] as Array<{ id: string; waiting_minutes: number; last_inbound_at: string }>);
    expect(oldest?.id).toBe("b");
  });

  it("sorts waiting oldest first without mutating source", () => {
    const source = [
      { id: "a", waiting_minutes: 5 },
      { id: "b", waiting_minutes: 50 }
    ];
    const sorted = sortWaitingOldestFirst(source);
    expect(sorted.map((item) => item.id)).toEqual(["b", "a"]);
    expect(source.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("formats exact waiting time for tooltips", () => {
    const label = formatWaitingExactTime("2026-11-25T12:30:00+03:00");
    expect(label.length).toBeGreaterThan(0);
  });
});
