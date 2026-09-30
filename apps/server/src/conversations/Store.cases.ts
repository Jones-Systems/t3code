import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportConversation, LibraryReply, LibraryRequest } from "@t3tools/contracts/conversationLibrary";
import { ConversationLibraryStore, type LibraryDatabase } from "./Store.ts";

function sample(id = "shared-chat", update = 100, answer = "Original answer"): ExportConversation {
  return {
    id, title: `Conversation ${id}`, update_time: update, current_node: "a",
    mapping: {
      root: { parent: null },
      u: { parent: "root", message: { author: { role: "user" }, content: { parts: ["Sample question"] } } },
      a: { parent: "u", message: { author: { role: "assistant" }, content: { parts: [answer] } } },
    },
  };
}

function expectKind<K extends LibraryReply["kind"]>(reply: LibraryReply, kind: K): Extract<LibraryReply, { kind: K }> {
  assert.equal(reply.kind, kind);
  return reply as Extract<LibraryReply, { kind: K }>;
}

function withStore(run: (store: ConversationLibraryStore, db: DatabaseSync) => void): void {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new ConversationLibraryStore(db, { initialize: true, clock: () => 1_800_000_000_000 });
    run(store, db);
  } finally { db.close(); }
}

function account(store: ConversationLibraryStore, label = "Account A", workspace = "Personal"): string {
  return expectKind(store.execute({ kind: "createAccount", label, workspace }, true), "account").account.id;
}

function imported(store: ConversationLibraryStore, accountId: string, conversations = [sample()]) {
  return expectKind(store.execute({ kind: "import", accountId, conversations }, true), "imported");
}

function rows(store: ConversationLibraryStore, input: Extract<LibraryRequest, { kind: "list" }> = { kind: "list" }) {
  return expectKind(store.execute(input, false), "list");
}

export const conversationStoreCases: readonly { readonly name: string; readonly run: () => void }[] = [
  { name: "stores supplied conversations and never advertises live capture", run: () => withStore((store) => {
    const id = account(store);
    assert.equal(imported(store, id).inserted, 1);
    const found = rows(store).rows;
    assert.equal(found.length, 1);
    assert.equal(found[0]!.unread, true);
    const hello = expectKind(store.execute({ kind: "hello" }, false), "hello");
    assert.equal(hello.capture, "not-enabled");
    assert.equal(hello.canWrite, false);
    const detail = expectKind(store.execute({ kind: "detail", key: found[0]!.key }, false), "detail");
    assert.deepEqual(detail.messages.map((message) => message.text), ["Sample question", "Original answer"]);
  }) },
  { name: "isolates identical conversation and node IDs across account/workspace bindings", run: () => withStore((store) => {
    const a = account(store, "A", "Personal"), b = account(store, "A", "Work");
    imported(store, a); imported(store, b);
    const first = rows(store, { kind: "list", accountId: a }).rows[0]!;
    const second = rows(store, { kind: "list", accountId: b }).rows[0]!;
    assert.notEqual(first.key, second.key);
    assert.notEqual(first.snapshotId, second.snapshotId);
    assert.throws(() => store.execute({ kind: "detail", key: first.key, snapshotId: second.snapshotId }, false), /does not exist/);
    assert.equal(rows(store).rows.length, 2);
  }) },
  { name: "duplicate imports are idempotent and do not create unread changes", run: () => withStore((store) => {
    const id = account(store); imported(store, id);
    const first = rows(store).rows[0]!;
    store.execute({ kind: "update", key: first.key, readThrough: first.revision }, true);
    const before = rows(store).revision;
    assert.equal(imported(store, id).duplicates, 1);
    const after = rows(store);
    assert.equal(after.revision, before);
    assert.equal(after.rows[0]!.unread, false);
  }) },
  { name: "old read acknowledgements cannot hide newer admitted content", run: () => withStore((store) => {
    const id = account(store); imported(store, id);
    const first = rows(store).rows[0]!;
    imported(store, id, [sample("shared-chat", 200, "New answer")]);
    store.execute({ kind: "update", key: first.key, readThrough: first.revision }, true);
    assert.equal(rows(store).rows[0]!.unread, true);
    assert.throws(() => store.execute({ kind: "update", key: first.key, readThrough: 99999 }, true), /future revision/);
  }) },
  { name: "pinning and archiving do not masquerade as new output", run: () => withStore((store) => {
    const id = account(store); imported(store, id);
    const first = rows(store).rows[0]!;
    store.execute({ kind: "update", key: first.key, readThrough: first.revision, pinned: true }, true);
    const pinned = rows(store, { kind: "list", view: "pinned" }).rows[0]!;
    assert.equal(pinned.revision, first.revision);
    assert.equal(pinned.unread, false);
    store.execute({ kind: "update", key: first.key, archived: true }, true);
    assert.equal(rows(store).rows.length, 0);
    assert.equal(rows(store, { kind: "list", view: "archived" }).rows.length, 1);
    imported(store, id);
    assert.equal(rows(store).rows.length, 0);
    store.execute({ kind: "update", key: first.key, archived: false }, true);
    assert.equal(rows(store).rows.length, 1);
  }) },
  { name: "retains late older snapshots without overwriting the selected transcript", run: () => withStore((store) => {
    const id = account(store); imported(store, id, [sample("shared-chat", 200, "Later")]);
    const first = rows(store).rows[0]!;
    const result = imported(store, id, [sample("shared-chat", 100, "Earlier")]);
    assert.equal(result.older, 1);
    const detail = expectKind(store.execute({ kind: "detail", key: first.key }, false), "detail");
    assert.equal(detail.snapshotCount, 2);
    assert.equal(detail.messages.at(-1)!.text, "Later");
    assert.equal(detail.conversation.revision, first.revision);
    const old = detail.snapshots.find((snapshot) => snapshot.id !== detail.snapshotId)!;
    const oldDetail = expectKind(store.execute({ kind: "detail", key: first.key, snapshotId: old.id }, false), "detail");
    assert.equal(oldDetail.messages.at(-1)!.text, "Earlier");
    assert.equal(oldDetail.readThrough, 0);
  }) },
  { name: "retains same-time conflicting snapshots until an explicit selection", run: () => withStore((store) => {
    const id = account(store); imported(store, id);
    const first = rows(store).rows[0]!;
    assert.equal(imported(store, id, [sample("shared-chat", 100, "Different")]).conflicts, 1);
    const current = rows(store).rows[0]!;
    assert.equal(current.conflicts, true);
    const detail = expectKind(store.execute({ kind: "detail", key: current.key }, false), "detail");
    assert.equal(detail.readThrough, 0);
    const conflict = detail.snapshots.find((snapshot) => snapshot.id !== detail.snapshotId)!;
    assert.throws(() => store.execute({ kind: "selectSnapshot", key: first.key, snapshotId: conflict.id, expectedRevision: first.revision }, true), /changed/);
    store.execute({ kind: "selectSnapshot", key: first.key, snapshotId: conflict.id, expectedRevision: current.revision }, true);
    const chosen = expectKind(store.execute({ kind: "detail", key: first.key }, false), "detail");
    assert.equal(chosen.messages.at(-1)!.text, "Different");
    assert.equal(chosen.conversation.conflicts, false);
  }) },
  { name: "missing update timestamps are not replaced with creation or import time", run: () => withStore((store) => {
    const id = account(store);
    const missing = { ...sample(), update_time: null, create_time: 500 };
    imported(store, id, [missing]);
    assert.equal(rows(store).rows[0]!.sourceUpdatedAt, null);
    assert.equal(imported(store, id, [sample("shared-chat", 600, "Known timestamp")]).conflicts, 1);
    assert.equal(rows(store).rows[0]!.sourceUpdatedAt, null);
  }) },
  { name: "rejects malformed batches before admitting their valid prefix", run: () => withStore((store) => {
    const id = account(store); const before = rows(store).revision;
    assert.throws(() => imported(store, id, [sample("good"), { ...sample("cycle"), mapping: { a: { parent: "a" } } }]), /cycle/);
    assert.equal(rows(store).rows.length, 0);
    assert.equal(rows(store).revision, before);
  }) },
  { name: "rolls back rows, snapshots, search and revision on an injected SQLite write failure", run: () => {
    const db = new DatabaseSync(":memory:"); let fail = false, writes = 0;
    const driver: LibraryDatabase = {
      exec: (sql) => db.exec(sql), close: () => db.close(),
      prepare: (sql) => {
        const statement = db.prepare(sql);
        return {
          get: (...values) => statement.get(...values), all: (...values) => statement.all(...values),
          run: (...values) => {
            if (fail && sql.startsWith("INSERT INTO nodes") && ++writes === 2) throw new Error("injected write failure");
            return statement.run(...values);
          },
        };
      },
    };
    try {
      const store = new ConversationLibraryStore(driver, { initialize: true });
      const id = account(store); const before = rows(store).revision; fail = true;
      assert.throws(() => imported(store, id), /injected/);
      assert.equal(rows(store).rows.length, 0);
      assert.equal(rows(store).revision, before);
      for (const table of ["snapshots", "nodes", "library_search"]) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
    } finally { db.close(); }
  } },
  { name: "pages the full catalog and rejects stale or differently scoped cursors", run: () => withStore((store) => {
    const id = account(store); imported(store, id, Array.from({ length: 61 }, (_, index) => sample(`chat-${index}`)));
    const first = rows(store);
    assert.equal(first.rows.length, 50); assert.ok(first.cursor);
    const second = rows(store, { kind: "list", cursor: first.cursor });
    assert.equal(second.rows.length, 11); assert.equal(second.cursor, null);
    assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.key)).size, 61);
    assert.throws(() => rows(store, { kind: "list", view: "unread", cursor: first.cursor! }), /list changed/);
    store.execute({ kind: "update", key: first.rows[0]!.key, pinned: true }, true);
    assert.throws(() => rows(store, { kind: "list", cursor: first.cursor! }), /list changed/);
    assert.throws(() => rows(store, { kind: "list", cursor: "garbage" }), /cursor is invalid/);
  }) },
  { name: "pages message bodies on a fixed branch with no gaps", run: () => withStore((store) => {
    const id = account(store);
    const mapping = Object.fromEntries(Array.from({ length: 135 }, (_, index) => [String(index), {
      parent: index === 0 ? null : String(index - 1),
      message: { author: { role: index % 2 ? "assistant" : "user" }, content: { parts: [`message ${index}`] } },
    }]));
    imported(store, id, [{ ...sample(), mapping, current_node: "134" }]);
    const key = rows(store).rows[0]!.key;
    const initial = expectKind(store.execute({ kind: "detail", key }, false), "detail");
    assert.equal(initial.offset, 100); assert.equal(initial.messages.length, 35);
    const seen: string[] = []; let start: number | null = 0;
    while (start !== null) {
      const detail: Extract<LibraryReply, { kind: "detail" }> = expectKind(store.execute({ kind: "detail", key, offset: start }, false), "detail");
      seen.push(...detail.messages.map((entry) => entry.id)); start = detail.nextOffset;
    }
    assert.equal(new Set(seen).size, 135);
    assert.deepEqual(seen, Array.from({ length: 135 }, (_, index) => String(index)));
  }) },
  { name: "searches selected snapshot text and handles literal query syntax safely", run: () => withStore((store) => {
    const id = account(store); imported(store, id, [sample("one", 100, "Distinctive answer"), sample("two", 100, "Other text")]);
    assert.equal(rows(store, { kind: "list", query: "Distinctive" }).rows[0]!.conversationId, "one");
    assert.equal(rows(store, { kind: "list", query: "one" }).rows.length, 1);
    for (const query of ['" OR *', '"', "(answer)", "not:syntax"]) {
      const result = rows(store, { kind: "list", query }); assert.ok(result.rows.length <= 2);
    }
  }) },
  { name: "search does not expose hidden exported text", run: () => withStore((store) => {
    const id = account(store);
    const original = sample();
    imported(store, id, [{ ...original, mapping: { ...original.mapping, secret: { message: { author: { role: "system" }, content: { parts: ["notindexabletoken"] }, metadata: { is_visually_hidden_from_conversation: true } } } } }]);
    assert.equal(rows(store, { kind: "list", query: "notindexabletoken" }).rows.length, 0);
  }) },
  { name: "removes only the selected local conversation and its retained data", run: () => withStore((store, db) => {
    const a = account(store), b = account(store, "B"); imported(store, a); imported(store, b);
    const first = rows(store, { kind: "list", accountId: a }).rows[0]!;
    imported(store, a, [sample("shared-chat", 200, "Newer")]);
    assert.throws(() => store.execute({ kind: "remove", key: first.key, expectedRevision: first.revision }, true), /changed/);
    const current = rows(store, { kind: "list", accountId: a }).rows[0]!;
    store.execute({ kind: "remove", key: current.key, expectedRevision: current.revision }, true);
    assert.equal(rows(store).rows.length, 1);
    assert.equal(rows(store).rows[0]!.accountId, b);
    assert.equal(db.prepare("SELECT count(*) AS n FROM snapshots WHERE conversation_key = ?").get(first.key)!.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM library_search WHERE key = ?").get(first.key)!.n, 0);
  }) },
  { name: "rejects every mutation for read-only callers", run: () => withStore((store) => {
    const id = account(store); imported(store, id); const first = rows(store).rows[0]!;
    const writes: LibraryRequest[] = [
      { kind: "createAccount", label: "B", workspace: "Personal" },
      { kind: "import", accountId: id, conversations: [sample("other")] },
      { kind: "update", key: first.key, pinned: true },
      { kind: "selectSnapshot", key: first.key, snapshotId: first.snapshotId, expectedRevision: first.revision },
      { kind: "remove", key: first.key, expectedRevision: first.revision },
    ];
    const before = rows(store).revision;
    for (const request of writes) assert.throws(() => store.execute(request, false), /cannot change/);
    assert.equal(rows(store).revision, before); assert.equal(rows(store).rows.length, 1);
  }) },
  { name: "future database versions fail closed without rewriting them", run: () => {
    const db = new DatabaseSync(":memory:");
    try { db.exec("PRAGMA user_version = 99"); assert.throws(() => new ConversationLibraryStore(db, { initialize: true }), /version is not supported/); assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 99); }
    finally { db.close(); }
  } },
  { name: "refuses to initialize an unrelated unversioned database", run: () => {
    const db = new DatabaseSync(":memory:");
    try { db.exec("CREATE TABLE unrelated (value TEXT)"); assert.throws(() => new ConversationLibraryStore(db, { initialize: true }), /unrecognized database/); assert.equal(db.prepare("SELECT count(*) AS n FROM unrelated").get()!.n, 0); }
    finally { db.close(); }
  } },
  { name: "persists across reopen and supports read-only SQLite connections", run: () => {
    const directory = mkdtempSync(join(tmpdir(), "t3-library-test-"));
    const path = join(directory, "library.sqlite");
    try {
      const db = new DatabaseSync(path);
      try { const store = new ConversationLibraryStore(db, { initialize: true }); imported(store, account(store)); }
      finally { db.close(); }
      const read = new DatabaseSync(path, { readOnly: true });
      try { const store = new ConversationLibraryStore(read); assert.equal(rows(store).rows.length, 1); }
      finally { read.close(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  } },
  { name: "retention limits reject new snapshots without deleting retained versions", run: () => withStore((store) => {
    const id = account(store);
    for (let version = 1; version <= 250; version++) imported(store, id, [sample("many", version, `version ${version}`)]);
    const key = rows(store).rows[0]!.key;
    const before = rows(store).revision;
    assert.throws(() => imported(store, id, [sample("many", 251, "too many")]), /retention limit/);
    const detail = expectKind(store.execute({ kind: "detail", key }, false), "detail");
    assert.equal(detail.snapshotCount, 250); assert.equal(rows(store).revision, before);
    assert.equal(detail.messages.at(-1)!.text, "version 250");
  }) },
];
