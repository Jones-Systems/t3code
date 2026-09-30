/**
 * Derive the provider-instance map shared by runtime hydration and usage reads.
 *
 * Legacy `providers.<kind>` settings are synthesized only for the default
 * instance id when no explicit entry already owns that id. The settings
 * schema's provider keys are the built-in drivers that have legacy mirrors.
 *
 * @module providerInstanceConfigMap
 */
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceConfigMap,
  type ServerSettings,
} from "@t3tools/contracts";

/**
 * Synthesize a `ProviderInstanceConfigMap` from a `ServerSettings` snapshot.
 * Explicit `providerInstances` entries win; each remaining built-in legacy
 * provider setting fills its default instance id.
 */
export const deriveProviderInstanceConfigMap = (
  settings: ServerSettings,
): ProviderInstanceConfigMap => {
  const merged: Record<string, ProviderInstanceConfig> = { ...settings.providerInstances };
  const legacyProviders = settings.providers as Record<string, unknown>;

  for (const rawDriver of Object.keys(legacyProviders)) {
    const driver = ProviderDriverKind.make(rawDriver);
    const instanceId = defaultInstanceIdForDriver(driver);
    if (instanceId in merged) {
      continue;
    }

    const legacyConfig = legacyProviders[rawDriver];
    if (legacyConfig === undefined) {
      continue;
    }

    merged[instanceId] = { driver, config: legacyConfig };
  }

  return merged as ProviderInstanceConfigMap;
};
