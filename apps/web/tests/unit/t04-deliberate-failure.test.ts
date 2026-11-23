import { expect, it } from "vitest";

// T0.4: deliberately failing test. This PR must be blocked by CI and must never be merged.
it("T0.4 deliberately fails so CI blocks the merge", () => {
  expect(1 + 1).toBe(3);
});
