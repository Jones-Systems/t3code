import * as NodeAssert from "node:assert/strict";
import { TurnId } from "@t3tools/contracts";
import { describe, it } from "vite-plus/test";

import {
  CODEX_CAPACITY_RECOVERY_STAGES,
  beginCodexCapacityRecovery,
  isCodexCapacityRecoveryEligible,
  nextCodexCapacityRecoveryAttempt,
} from "./CodexCapacityRecovery.ts";

describe("CodexCapacityRecovery", () => {
  it("only admits an exact Sol medium initial selection", () => {
    NodeAssert.equal(
      isCodexCapacityRecoveryEligible({ model: "gpt-5.6-sol", effort: "medium" }),
      true,
    );
    NodeAssert.equal(
      isCodexCapacityRecoveryEligible({ model: "gpt-5.6-sol", effort: "high" }),
      false,
    );
    NodeAssert.equal(
      isCodexCapacityRecoveryEligible({ model: "gpt-6-astra", effort: "medium" }),
      false,
    );
    NodeAssert.equal(
      isCodexCapacityRecoveryEligible({ model: undefined, effort: "medium" }),
      false,
    );
  });

  it("advances through exactly twenty attempts for each tuple", () => {
    let state = beginCodexCapacityRecovery(TurnId.make("logical-turn"));
    const attempts: Array<{
      model: string;
      effort: string;
      attempt: number;
      stageOffsetMs: number;
    }> = [];

    for (;;) {
      const decision = nextCodexCapacityRecoveryAttempt(state);
      if (decision._tag === "exhausted") break;
      state = decision.state;
      attempts.push({
        ...decision.stage,
        attempt: state.attempt,
        stageOffsetMs: decision.stageOffsetMs,
      });
    }

    NodeAssert.equal(attempts.length, 60);
    for (const [stageIndex, stage] of CODEX_CAPACITY_RECOVERY_STAGES.entries()) {
      NodeAssert.deepStrictEqual(
        attempts.slice(stageIndex * 20, (stageIndex + 1) * 20),
        Array.from({ length: 20 }, (_, index) => ({
          ...stage,
          attempt: index + 1,
          stageOffsetMs: (index + 1) * 15_000,
        })),
      );
    }
  });
});
