// @effect-diagnostics nodeBuiltinImport:off
// This module is imported by the standalone service launcher. Keep its
// runtime dependencies limited to Node built-ins.
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const NATIVE_AUTHORITY_ROOT = ".t3-native-authority";

export const nativeStoreAuthorityBaseDirFingerprint = (baseDir: string): string =>
  `sha256:${NodeCrypto.createHash("sha256").update(NodePath.resolve(baseDir)).digest("hex")}`;

export const defaultNativeStoreAuthorityStateDir = (baseDir: string): string =>
  NodePath.join(
    NodeOS.homedir(),
    NATIVE_AUTHORITY_ROOT,
    "v1",
    nativeStoreAuthorityBaseDirFingerprint(baseDir).slice("sha256:".length),
  );

export const resolveNativeStoreAuthorityStateDir = (
  baseDir: string,
  configured?: string,
): string => {
  const trimmed = configured?.trim();
  if (trimmed === undefined || trimmed === "") {
    return defaultNativeStoreAuthorityStateDir(baseDir);
  }
  const expanded =
    trimmed === "~"
      ? NodeOS.homedir()
      : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
        ? NodePath.join(NodeOS.homedir(), trimmed.slice(2))
        : trimmed;
  return NodePath.resolve(expanded);
};
