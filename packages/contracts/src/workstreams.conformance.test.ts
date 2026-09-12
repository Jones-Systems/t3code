import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { createHash } from "node:crypto";

import conformanceRaw from "./workstreams-fixtures/conformance.json.fixture?raw";
import negativesRaw from "./workstreams-fixtures/negative-cases.json.fixture?raw";
import semanticRaw from "./workstreams-fixtures/semantic-cases.json.fixture?raw";
import {
  Workstream,
  WorkstreamCapabilities,
  WorkstreamCommand,
  WorkstreamDelivery,
  WorkstreamFreshness,
  WorkstreamLifecycleDeclaration,
  WorkstreamNativeIdentity,
  WorkstreamProgress,
  WorkstreamPrLocator,
  WorkstreamRegistrationVerification,
  DeclarationRevision,
  MembershipEpisode,
  WorkstreamDeclarationPage,
  WorkstreamDetail,
  WorkstreamEdgePage,
  WorkstreamHistoryPage,
  WorkstreamMembershipPage,
  WorkstreamPage,
  WorkstreamPrObservation,
  WorkstreamReceipt,
  WorkstreamReferenceDetail,
  WorkstreamReferencePage,
} from "./workstreams.ts";

const options = { onExcessProperty: "error" as const };
const conformance = JSON.parse(conformanceRaw) as FixtureCorpus;
const negatives = JSON.parse(negativesRaw) as FixtureCorpus;
interface FixtureCorpus {
  readonly cases: ReadonlyArray<{
    readonly name: string;
    readonly schema: string;
    readonly value: unknown;
  }>;
}
const supported = new Map<string, (value: unknown) => unknown>([
  ["Command", (value) => Schema.decodeUnknownSync(WorkstreamCommand)(value, options)],
  ["Workstream", (value) => Schema.decodeUnknownSync(Workstream)(value, options)],
  ["NativeIdentity", (value) => Schema.decodeUnknownSync(WorkstreamNativeIdentity)(value, options)],
  ["PrLocator", (value) => Schema.decodeUnknownSync(WorkstreamPrLocator)(value, options)],
  ["MembershipEpisode", (value) => Schema.decodeUnknownSync(MembershipEpisode)(value, options)],
  ["DeclarationRevision", (value) => Schema.decodeUnknownSync(DeclarationRevision)(value, options)],
  [
    "LifecycleDeclaration",
    (value) => Schema.decodeUnknownSync(WorkstreamLifecycleDeclaration)(value, options),
  ],
  ["ProgressCondition", (value) => Schema.decodeUnknownSync(WorkstreamProgress)(value, options)],
  ["DeliveryState", (value) => Schema.decodeUnknownSync(WorkstreamDelivery)(value, options)],
  ["FreshnessState", (value) => Schema.decodeUnknownSync(WorkstreamFreshness)(value, options)],
  [
    "RegistrationVerification",
    (value) => Schema.decodeUnknownSync(WorkstreamRegistrationVerification)(value, options),
  ],
  ["PrObservation", (value) => Schema.decodeUnknownSync(WorkstreamPrObservation)(value, options)],
  ["Receipt", (value) => Schema.decodeUnknownSync(WorkstreamReceipt)(value, options)],
  ["WorkstreamPage", (value) => Schema.decodeUnknownSync(WorkstreamPage)(value, options)],
  ["ReferencePage", (value) => Schema.decodeUnknownSync(WorkstreamReferencePage)(value, options)],
  ["MembershipPage", (value) => Schema.decodeUnknownSync(WorkstreamMembershipPage)(value, options)],
  [
    "DeclarationPage",
    (value) => Schema.decodeUnknownSync(WorkstreamDeclarationPage)(value, options),
  ],
  ["EdgePage", (value) => Schema.decodeUnknownSync(WorkstreamEdgePage)(value, options)],
  ["HistoryPage", (value) => Schema.decodeUnknownSync(WorkstreamHistoryPage)(value, options)],
  ["WorkstreamDetail", (value) => Schema.decodeUnknownSync(WorkstreamDetail)(value, options)],
  [
    "ReferenceDetail",
    (value) => Schema.decodeUnknownSync(WorkstreamReferenceDetail)(value, options),
  ],
  ["Capabilities", (value) => Schema.decodeUnknownSync(WorkstreamCapabilities)(value, options)],
]);

const schemaName = (reference: string) => reference.slice(reference.lastIndexOf("/") + 1);

describe("frozen accepted Workstream v1 fixtures", () => {
  it("preserves all immutable source bytes", () => {
    const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(sha256(conformanceRaw)).toBe(
      "a907dfa46f18a1930d0bd176571743d4932ae6dd13fc96421d5dec8e63bd6aa1",
    );
    expect(sha256(negativesRaw)).toBe(
      "d4893333b797c53249f37cd9cc04c605ca54eeed542dcab0c62f6a6c91093d50",
    );
    expect(sha256(semanticRaw)).toBe(
      "1d939c25a2f9b9aca0191b390ba8739fcd8f6d2e40bb0f1e6ae389c2eb05a6fa",
    );
  });

  it("accepts every fixture for a T3-supported DTO decoder", () => {
    const exercised = new Set<string>();
    for (const fixture of conformance.cases) {
      const name = schemaName(fixture.schema);
      const decode = supported.get(name);
      if (decode === undefined) continue;
      expect(() => decode(fixture.value), fixture.name).not.toThrow();
      exercised.add(name);
    }
    for (const required of [
      "Command",
      "Workstream",
      "NativeIdentity",
      "MembershipEpisode",
      "DeclarationRevision",
      "LifecycleDeclaration",
      "PrObservation",
      "Receipt",
      "WorkstreamPage",
      "ReferenceDetail",
      "Capabilities",
    ])
      expect(exercised.has(required), required).toBe(true);
  });

  it("rejects every relevant negative fixture", () => {
    let exercised = 0;
    for (const fixture of negatives.cases) {
      const decode = supported.get(schemaName(fixture.schema));
      if (decode === undefined) continue;
      expect(() => decode(fixture.value), fixture.name).toThrow();
      exercised += 1;
    }
    expect(exercised).toBeGreaterThanOrEqual(10);
  });
});
