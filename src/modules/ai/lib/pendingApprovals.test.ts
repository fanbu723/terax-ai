import { describe, expect, it } from "vitest";
import { pendingApprovalIds } from "./pendingApprovals";

type Part = { state?: string; approval?: { id?: string } };

const assistant = (...parts: Part[]) => ({ role: "assistant", parts });
const user = (...parts: Part[]) => ({ role: "user", parts });

const requested = (id: string): Part => ({
  state: "approval-requested",
  approval: { id },
});

describe("pendingApprovalIds", () => {
  it("lists approval requests in message and part order", () => {
    expect(
      pendingApprovalIds([
        user(requested("u")),
        assistant(requested("a"), requested("b")),
        assistant({ state: "output-available" }, requested("c")),
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("ignores non-approval states", () => {
    expect(
      pendingApprovalIds([
        assistant(
          { state: "input-available" },
          { state: "approval-responded", approval: { id: "x" } },
          { state: "output-error" },
          requested("keep"),
        ),
      ]),
    ).toEqual(["keep"]);
  });

  it("ignores user messages and parts without an id", () => {
    expect(
      pendingApprovalIds([
        user(requested("ignored")),
        assistant(requested("")),
        assistant({ state: "approval-requested" }),
        assistant(requested("kept")),
      ]),
    ).toEqual(["kept"]);
  });

  it("returns an empty list when nothing is waiting", () => {
    expect(pendingApprovalIds([])).toEqual([]);
    expect(
      pendingApprovalIds([assistant({ state: "output-available" })]),
    ).toEqual([]);
  });
});
