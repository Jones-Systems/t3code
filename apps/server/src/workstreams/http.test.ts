import { describe, expect, it } from "vite-plus/test";

import { isWorkstreamHttpTarget, WORKSTREAM_RESPONSE_HEADERS } from "./http.ts";

describe("Workstream HTTP response containment", () => {
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
