import type { TurnId } from "@t3tools/contracts";

export const CODEX_CAPACITY_RETRY_DELAY = "15 seconds";
export const CODEX_CAPACITY_RETRY_DELAY_MS = 15_000;
export const CODEX_CAPACITY_RETRIES_PER_STAGE = 20;

export interface CodexCapacityRecoveryStage {
  readonly model: string;
  readonly effort: string;
}

export const CODEX_CAPACITY_RECOVERY_STAGES = [
  { model: "gpt-5.6-sol", effort: "medium" },
  { model: "gpt-5.6-sol", effort: "high" },
  { model: "gpt-6-astra", effort: "medium" },
] as const satisfies ReadonlyArray<CodexCapacityRecoveryStage>;

export interface CodexCapacityRecoveryState {
  readonly logicalTurnId: TurnId;
  readonly currentNativeTurnId: TurnId;
  readonly stageIndex: number;
  readonly attempt: number;
}

export type CodexCapacityRecoveryDecision =
  | {
      readonly _tag: "schedule";
      readonly state: CodexCapacityRecoveryState;
      readonly stage: CodexCapacityRecoveryStage;
      readonly switchedStage: boolean;
      readonly stageOffsetMs: number;
    }
  | { readonly _tag: "exhausted" };

export function isCodexCapacityRecoveryEligible(input: {
  readonly model: string | undefined;
  readonly effort: string | undefined;
}): boolean {
  return input.model === "gpt-5.6-sol" && input.effort === "medium";
}

export function beginCodexCapacityRecovery(turnId: TurnId): CodexCapacityRecoveryState {
  return {
    logicalTurnId: turnId,
    currentNativeTurnId: turnId,
    stageIndex: 0,
    attempt: 0,
  };
}

export function nextCodexCapacityRecoveryAttempt(
  state: CodexCapacityRecoveryState,
): CodexCapacityRecoveryDecision {
  if (state.attempt < CODEX_CAPACITY_RETRIES_PER_STAGE) {
    const nextState = { ...state, attempt: state.attempt + 1 };
    return {
      _tag: "schedule",
      state: nextState,
      stage: CODEX_CAPACITY_RECOVERY_STAGES[state.stageIndex]!,
      switchedStage: false,
      stageOffsetMs: nextState.attempt * CODEX_CAPACITY_RETRY_DELAY_MS,
    };
  }

  const nextStageIndex = state.stageIndex + 1;
  const nextStage = CODEX_CAPACITY_RECOVERY_STAGES[nextStageIndex];
  if (!nextStage) {
    return { _tag: "exhausted" };
  }

  return {
    _tag: "schedule",
    state: {
      ...state,
      stageIndex: nextStageIndex,
      attempt: 1,
    },
    stage: nextStage,
    switchedStage: true,
    stageOffsetMs: CODEX_CAPACITY_RETRY_DELAY_MS,
  };
}

export function bindCodexCapacityRecoveryNativeTurn(
  state: CodexCapacityRecoveryState,
  nativeTurnId: TurnId,
): CodexCapacityRecoveryState {
  return { ...state, currentNativeTurnId: nativeTurnId };
}
