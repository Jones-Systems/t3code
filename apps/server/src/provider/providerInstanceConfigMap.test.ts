import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";

import { deriveProviderInstanceConfigMap } from "./providerInstanceConfigMap.ts";

describe("deriveProviderInstanceConfigMap", () => {
  it("preserves explicit instances and fills only unclaimed legacy defaults", () => {
    const codexId = ProviderInstanceId.make("codex");
    const customCodexId = ProviderInstanceId.make("codex_personal");
    const explicitCodex = {
      driver: ProviderDriverKind.make("codex"),
      displayName: "Personal Codex",
      config: { homePath: "/personal" },
    };
    const customCodex = {
      driver: ProviderDriverKind.make("codex"),
      config: { homePath: "/work" },
    };
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        ...DEFAULT_SERVER_SETTINGS.providerInstances,
        [codexId]: explicitCodex,
        [customCodexId]: customCodex,
      },
    };

    const configMap = deriveProviderInstanceConfigMap(settings);

    assert.strictEqual(configMap[codexId], explicitCodex);
    assert.strictEqual(configMap[customCodexId], customCodex);
    assert.strictEqual(
      configMap[ProviderInstanceId.make("claudeAgent")]?.config,
      DEFAULT_SERVER_SETTINGS.providers.claudeAgent,
    );
    assert.strictEqual(
      configMap[ProviderInstanceId.make("grok")]?.config,
      DEFAULT_SERVER_SETTINGS.providers.grok,
    );
  });
});
