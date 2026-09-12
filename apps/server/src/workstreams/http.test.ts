import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { HttpIncomingMessage } from "effect/unstable/http";

import {
  isWorkstreamHttpTarget,
  withWorkstreamBodyLimit,
  WORKSTREAM_RESPONSE_HEADERS,
} from "./http.ts";

describe("Workstream HTTP response containment", () => {
  it("caps the placement POST body before payload decoding without changing adjacent routes", () => {
    const limit = (method: string, originalUrl: string) =>
      Effect.runSync(
        withWorkstreamBodyLimit(HttpIncomingMessage.MaxBodySize, { method, originalUrl }),
      );
    expect(limit("POST", "/api/workstreams/thread-placements")).toBe(262_144n);
    expect(limit("POST", "/api/workstreams/thread-placements?extra=x")).toBe(262_144n);
    expect(limit("POST", "/api/workstreams/commands")).toBeUndefined();
    expect(limit("GET", "/api/workstreams")).toBeUndefined();
  });
  it("selects every Workstream API result and excludes adjacent APIs", () => {
    expect(isWorkstreamHttpTarget("/api/workstreams")).toBe(true);
    expect(isWorkstreamHttpTarget("/api/workstreams?limit=50")).toBe(true);
    expect(isWorkstreamHttpTarget("/api/workstreams/ws-1/history?cursor=next")).toBe(true);
    expect(isWorkstreamHttpTarget("/api/orchestration/snapshot")).toBe(false);
    expect(WORKSTREAM_RESPONSE_HEADERS).toEqual({
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
  });
});
