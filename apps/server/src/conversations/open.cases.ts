import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openConversationLibrary } from "./open.ts";

async function owned(run: (path: string) => Promise<void>): Promise<void> {
  const path = mkdtempSync(join(tmpdir(), "t3-library-open-"));
  try { await run(path); } finally { rmSync(path, { recursive: true, force: true }); }
}

export const libraryOpenCases = [
  { name: "a missing read-only library creates no files", run: () => owned(async (root) => {
    const store = await openConversationLibrary(root, false, 123);
    try { assert.deepEqual(store.execute({ kind: "accounts" }, false), { kind: "accounts", accounts: [] }); }
    finally { store.close(); }
    assert.equal(existsSync(join(root, "conversation-library")), false);
  }) },
  { name: "creates a private independent library and reopens it read-only", run: () => owned(async (root) => {
    writeFileSync(join(root, "state.sqlite"), "not the library");
    let store = await openConversationLibrary(root, true, 123);
    try { store.execute({ kind: "createAccount", label: "Example", workspace: "Personal" }, true); } finally { store.close(); }
    store = await openConversationLibrary(root, false, 456);
    try { const reply = store.execute({ kind: "accounts" }, false); assert.equal(reply.kind, "accounts"); if (reply.kind === "accounts") assert.equal(reply.accounts.length, 1); } finally { store.close(); }
    if (process.platform !== "win32") {
      assert.equal(statSync(join(root, "conversation-library")).mode & 0o077, 0);
      assert.equal(statSync(join(root, "conversation-library", "library.sqlite")).mode & 0o077, 0);
    }
    assert.equal(statSync(join(root, "state.sqlite")).size, 15);
  }) },
  { name: "rejects a symlinked library directory", run: () => owned(async (root) => {
    const target = join(root, "target"); mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, join(root, "conversation-library"), "dir");
    await assert.rejects(openConversationLibrary(root, true, 123), /private/);
    assert.equal(existsSync(join(target, "library.sqlite")), false);
  }) },
  { name: "rejects a symlinked database without changing its target", run: () => owned(async (root) => {
    const directory = join(root, "conversation-library"); mkdirSync(directory, { mode: 0o700 });
    const target = join(root, "unrelated"); writeFileSync(target, "protected", { mode: 0o600 });
    symlinkSync(target, join(directory, "library.sqlite"));
    await assert.rejects(openConversationLibrary(root, true, 123), /private/);
    assert.equal(statSync(target).size, 9);
  }) },
];
