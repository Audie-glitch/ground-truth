import { describe, expect, it } from "vitest";

import { rankWindows, windowFor } from "./earn-status";

describe("earning windows", () => {
  it("treats BUIDL CTC as open on 3 Sep 2026", () => {
    expect(windowFor("buidl-ctc", new Date("2026-09-03T02:34:00Z")).state).toBe(
      "open",
    );
  });

  it("keeps the KeeperHub feature bounty closed until 6 Sep 00:00 CEST", () => {
    expect(
      windowFor("keeperhub-feature", new Date("2026-09-03T02:34:00Z")).state,
    ).toBe("not-yet");
    expect(
      windowFor("keeperhub-feature", new Date("2026-09-05T21:59:59Z")).state,
    ).toBe("not-yet");
    expect(
      windowFor("keeperhub-feature", new Date("2026-09-05T22:00:00Z")).state,
    ).toBe("open");
  });

  it("keeps ETHOnline project code closed before 4 Sep 16:00 UTC", () => {
    expect(windowFor("ethonline", new Date("2026-09-03T12:00:00Z")).state).toBe(
      "not-yet",
    );
    expect(windowFor("ethonline", new Date("2026-09-04T16:00:00Z")).state).toBe(
      "open",
    );
  });

  it("closes BUIDL CTC after 13 Sep 23:59 Eastern", () => {
    expect(windowFor("buidl-ctc", new Date("2026-09-14T03:59:00Z")).state).toBe(
      "open",
    );
    expect(windowFor("buidl-ctc", new Date("2026-09-14T04:00:00Z")).state).toBe(
      "closed",
    );
  });

  it("ranks currently open code work ahead of windows that have not opened", () => {
    const ranked = rankWindows(new Date("2026-09-03T02:34:00Z"));
    expect(ranked[0]?.id).toBe("buidl-ctc");
    expect(ranked.find((row) => row.id === "keeperhub-feature")?.state).toBe(
      "not-yet",
    );
    expect(ranked.some((row) => row.state === "open")).toBe(true);
  });
});
