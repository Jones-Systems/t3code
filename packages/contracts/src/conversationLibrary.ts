/** The library is a read model of supplied records, never a coding provider. */
export const CONVERSATION_LIBRARY_PROTOCOL = "t3.conversation-library.v1";
export const CONVERSATION_LIBRARY_PATH = "/api/conversation-library";
export const LIBRARY_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
export const LIBRARY_MAX_CONVERSATIONS = 1_000;
export const LIBRARY_MAX_NODES = 10_000;
export const LIBRARY_MAX_TEXT_BYTES = 8 * 1024 * 1024;
export const LIBRARY_PAGE_SIZE = 50;

export interface ExportMessage {
  readonly id?: string | null;
  readonly author: { readonly role: string };
  readonly create_time?: number | null;
  readonly content?: {
    readonly content_type?: string;
    readonly parts?: readonly unknown[];
    readonly text?: string;
  } | null;
  readonly metadata?: { readonly is_visually_hidden_from_conversation?: boolean };
}

export interface ExportNode {
  readonly id?: string;
  readonly parent?: string | null;
  readonly message?: ExportMessage | null;
}

export interface ExportConversation {
  readonly id?: string;
  readonly conversation_id?: string;
  readonly title: string;
  readonly create_time?: number | null;
  readonly update_time?: number | null;
  readonly current_node?: string | null;
  readonly mapping: Readonly<Record<string, ExportNode>>;
}

export interface LibraryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly messageId: string | null;
  readonly role: string | null;
  readonly text: string;
  readonly createdAt: number | null;
  readonly hidden: boolean;
  readonly unsupportedParts: number;
}

export interface LibrarySnapshot {
  readonly conversationId: string;
  readonly title: string;
  readonly sourceUpdatedAt: number | null;
  readonly currentNodeId: string | null;
  readonly nodes: readonly LibraryNode[];
  readonly warnings: readonly string[];
}

export interface LibraryAccount {
  readonly id: string;
  readonly label: string;
  readonly workspace: string;
}

export type LibraryView = "all" | "unread" | "pinned" | "archived" | "attention";

export interface LibrarySummary {
  readonly key: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly title: string;
  readonly snapshotId: string;
  readonly sourceUpdatedAt: number | null;
  readonly importedAt: number;
  readonly revision: number;
  readonly unread: boolean;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly attention: boolean;
  readonly conflicts: boolean;
  readonly messageCount: number;
  readonly warningCount: number;
}

export interface LibrarySnapshotSummary {
  readonly id: string;
  readonly sourceUpdatedAt: number | null;
  readonly importedAt: number;
  readonly messageCount: number;
}

export type LibraryRequest =
  | { readonly kind: "hello" }
  | { readonly kind: "accounts" }
  | { readonly kind: "createAccount"; readonly label: string; readonly workspace: string }
  | { readonly kind: "preview"; readonly conversations: readonly ExportConversation[] }
  | { readonly kind: "import"; readonly accountId: string; readonly conversations: readonly ExportConversation[] }
  | { readonly kind: "list"; readonly accountId?: string; readonly query?: string; readonly view?: LibraryView; readonly cursor?: string }
  | { readonly kind: "detail"; readonly key: string; readonly snapshotId?: string; readonly nodeId?: string; readonly offset?: number; readonly snapshotOffset?: number; readonly branchOffset?: number; readonly showHidden?: boolean }
  | { readonly kind: "update"; readonly key: string; readonly pinned?: boolean; readonly archived?: boolean; readonly attention?: boolean; readonly readThrough?: number }
  | { readonly kind: "selectSnapshot"; readonly key: string; readonly snapshotId: string; readonly expectedRevision: number }
  | { readonly kind: "remove"; readonly key: string; readonly expectedRevision: number };

export interface LibraryDetail {
  readonly kind: "detail";
  readonly conversation: LibrarySummary;
  readonly account: LibraryAccount;
  readonly snapshotId: string;
  readonly nodeId: string | null;
  readonly messages: readonly LibraryNode[];
  readonly totalMessages: number;
  readonly offset: number;
  readonly previousOffset: number | null;
  readonly nextOffset: number | null;
  readonly snapshots: readonly LibrarySnapshotSummary[];
  readonly snapshotOffset: number;
  readonly snapshotCount: number;
  readonly branches: readonly { readonly id: string; readonly preview: string }[];
  readonly branchOffset: number;
  readonly branchCount: number;
  readonly warnings: readonly string[];
}

export type LibraryReply =
  | { readonly kind: "hello"; readonly protocol: typeof CONVERSATION_LIBRARY_PROTOCOL; readonly revision: number; readonly canWrite: boolean; readonly capture: "not-enabled" }
  | { readonly kind: "accounts"; readonly accounts: readonly LibraryAccount[] }
  | { readonly kind: "account"; readonly account: LibraryAccount }
  | { readonly kind: "preview"; readonly conversations: readonly { readonly id: string; readonly title: string; readonly messageCount: number; readonly warningCount: number }[] }
  | { readonly kind: "imported"; readonly inserted: number; readonly duplicates: number; readonly older: number; readonly conflicts: number; readonly revision: number }
  | { readonly kind: "list"; readonly rows: readonly LibrarySummary[]; readonly revision: number; readonly cursor: string | null }
  | LibraryDetail
  | { readonly kind: "updated"; readonly revision: number }
  | { readonly kind: "removed"; readonly revision: number };

export type LibraryErrorCode = "invalid" | "too-large" | "not-found" | "conflict" | "unsupported" | "storage";
