// @effect-diagnostics nodeBuiltinImport:off - the suite seeds and grows real
// transcript trees on disk, outside the service's Effect FileSystem.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageDay,
  type ProviderInstanceConfig,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scheduler from "effect/Scheduler";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageService from "./UsageService.ts";

function claudeLine(id: number, outputTokens: number): string {
  return `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-01T10:00:00Z",
    requestId: `req_${id}`,
    sessionId: "session-1",
    message: {
      id: `msg_${id}`,
      model: "claude-fable-5",
      usage: { input_tokens: 10, output_tokens: outputTokens },
    },
  })}\n`;
}

function codexTranscript(sessionId: string, outputTokens: number): string {
  const timestamp = "2026-08-01T10:00:00.000Z";
  return [
    {
      type: "session_meta",
      timestamp,
      payload: { type: "session_meta", id: sessionId },
    },
    {
      type: "turn_context",
      timestamp,
      payload: { type: "turn_context", model: "gpt-5.6-sol" },
    },
    {
      type: "event_msg",
      timestamp,
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 10,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: outputTokens,
            reasoning_output_tokens: 0,
          },
        },
      },
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n")
    .concat("\n");
}

function grokTranscript(sessionId: string, outputTokens: number): string {
  return `${JSON.stringify({
    timestamp: 1_785_578_400,
    method: "_x.ai/session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "turn_completed",
        prompt_id: "prompt-1",
        usage: {
          inputTokens: 10,
          outputTokens,
          totalTokens: 10 + outputTokens,
          cachedReadTokens: 0,
          cacheCreationTokens: 0,
          reasoningTokens: 0,
          costUsdTicks: 0,
          modelUsage: {
            "grok-4.5-build": {
              inputTokens: 10,
              outputTokens,
              totalTokens: 10 + outputTokens,
              cachedReadTokens: 0,
              cacheCreationTokens: 0,
              reasoningTokens: 0,
              costUsdTicks: 0,
            },
          },
        },
      },
      _meta: { eventId: "event-1", agentTimestampMs: 1_785_578_400_000 },
    },
  })}\n`;
}

const providerInstance = (
  driver: string,
  config: unknown,
  options: Omit<ProviderInstanceConfig, "driver" | "config"> = {},
): ProviderInstanceConfig => ({
  driver: ProviderDriverKind.make(driver),
  ...options,
  config,
});

const providerEnvironment = (name: string, value: string) => [{ name, value, sensitive: false }];

const WINDOW: UsageSummaryInput = {
  timeZone: "UTC",
  sinceDay: UsageDay.make("2026-07-31"),
  untilDay: UsageDay.make("2026-08-02"),
};

const setup = Effect.gen(function* () {
  const home = yield* Effect.promise(() =>
    NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-service-test-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
  );
  const transcriptDir = NodePath.join(home, "claude", "projects", "proj");
  yield* Effect.promise(() => NodeFSP.mkdir(transcriptDir, { recursive: true }));
  return {
    home,
    transcript: NodePath.join(transcriptDir, "session.jsonl"),
    settings: {
      providers: {
        claudeAgent: { homePath: NodePath.join(home, "claude") },
        codex: { homePath: NodePath.join(home, "codex") },
      },
    },
  };
});

const serviceLayers = (input: {
  readonly prefix: string;
  readonly home: string;
  readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
  readonly onRatesFetch?: () => void;
  readonly environment?: NodeJS.ProcessEnv;
  /** Defaults to an unparsable document so every scan retries the fetch. */
  readonly ratesDocument?: unknown;
}) =>
  ServerConfig.layerTest(process.cwd(), { prefix: input.prefix }).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(ServerSettings.layerTest(input.settings)),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            input.onRatesFetch?.();
            // Unparsable rates: every scan retries the fetch, which makes the
            // fetch count a boundary-level observation of how many scans ran.
            return HttpClientResponse.fromWeb(request, Response.json(input.ratesDocument ?? {}));
          }),
        ),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(HostProcessEnvironment, {
        GROK_HOME: NodePath.join(input.home, "grok"),
        ...input.environment,
      }),
    ),
  );

function totalOutputTokens(summary: { buckets: readonly { totals: { outputTokens: number } }[] }) {
  return summary.buckets.reduce((sum, bucket) => sum + bucket.totals.outputTokens, 0);
}

describe("UsageService", () => {
  it.live("counts appended usage on a rescan of a grown transcript", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));

      const service = yield* UsageService.make.pipe(
        Effect.provide(serviceLayers({ prefix: "usage-service-grow-test", home, settings })),
      );

      const first = yield* service.readSummary(WINDOW);
      assert.strictEqual(totalOutputTokens(first), 5);

      yield* Effect.promise(() => NodeFSP.appendFile(transcript, claudeLine(2, 7)));
      const second = yield* service.readSummary(WINDOW);
      assert.strictEqual(totalOutputTokens(second), 12);
    }).pipe(Effect.scoped),
  );

  it.live("shares one scan between concurrent identical requests", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));

      let ratesFetches = 0;
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-service-flight-test",
            home,
            settings,
            onRatesFetch: () => {
              ratesFetches += 1;
            },
          }),
        ),
      );

      const [first, second] = yield* Effect.all(
        [service.readSummary(WINDOW), service.readSummary(WINDOW)],
        { concurrency: 2 },
      );
      assert.deepStrictEqual(first, second);
      assert.strictEqual(ratesFetches, 1);

      // A later request is fresh work again, not a stale cached answer.
      yield* service.readSummary(WINDOW);
      assert.strictEqual(ratesFetches, 2);
    }).pipe(Effect.scoped),
  );

  it.live(
    "scans separate configured Codex roots once and keeps legacy and modern windows distinct",
    () =>
      Effect.gen(function* () {
        const { settings, home } = yield* setup;
        const sharedHome = NodePath.join(home, "codex-shared");
        const workHome = NodePath.join(home, "codex-work");
        const sharedSessions = NodePath.join(sharedHome, "sessions");
        const workSessions = NodePath.join(workHome, "sessions");
        yield* Effect.promise(() => NodeFSP.mkdir(sharedSessions, { recursive: true }));
        yield* Effect.promise(() => NodeFSP.mkdir(workSessions, { recursive: true }));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(sharedSessions, "personal.jsonl"),
            codexTranscript("personal-session", 5),
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(workSessions, "work.jsonl"),
            codexTranscript("work-session", 7),
          ),
        );

        const settingsWithInstances = {
          ...settings,
          providers: {
            ...settings.providers,
            codex: { homePath: sharedHome },
          },
          providerInstances: {
            codex_personal: providerInstance(
              "codex",
              {
                homePath: sharedHome,
                shadowHomePath: NodePath.join(home, "shadow-personal"),
              },
              { displayName: "Codex Personal" },
            ),
            codex_personal_alias: providerInstance("codex", {
              homePath: sharedHome,
              shadowHomePath: NodePath.join(home, "shadow-personal-alias"),
            }),
            codex_work: providerInstance(
              "codex",
              { homePath: workHome },
              { displayName: "Codex Work" },
            ),
          },
        };

        const service = yield* UsageService.make.pipe(
          Effect.provide(
            serviceLayers({
              prefix: "usage-service-configured-roots-test",
              home,
              settings: settingsWithInstances,
            }),
          ),
        );
        const hourlyWindow: UsageSummaryInput = {
          ...WINDOW,
          resolution: "hour",
          sinceTime: "2026-08-01T09:00:00.000Z",
          untilTime: "2026-08-01T11:00:00.000Z",
        };
        const [legacy, modern] = yield* Effect.all(
          [
            service.readSummary(hourlyWindow),
            service.readSummary({ ...hourlyWindow, includeProviderInstances: true }),
          ],
          { concurrency: 2 },
        );

        assert.isUndefined(legacy.providerInstances);
        assert.strictEqual(legacy.sources.length, 3);
        assert.isTrue(legacy.sources.every((source) => source.sourceId === undefined));
        assert.isTrue(legacy.buckets.every((bucket) => bucket.sourceId === undefined));

        assert.isDefined(modern.providerInstances);
        const codexSources = modern.sources.filter(
          (source) => source.fingerprint.provider === "codex",
        );
        assert.strictEqual(codexSources.length, 2);
        const [canonicalSharedSessions, canonicalWorkSessions] = yield* Effect.promise(() =>
          Promise.all([NodeFSP.realpath(sharedSessions), NodeFSP.realpath(workSessions)]),
        );
        const personalSource = codexSources.find(
          (source) => source.fingerprint.resolvedHomePath === canonicalSharedSessions,
        );
        const workSource = codexSources.find(
          (source) => source.fingerprint.resolvedHomePath === canonicalWorkSessions,
        );
        assert.isDefined(personalSource);
        assert.isDefined(workSource);
        assert.deepStrictEqual(personalSource.instanceIds, [
          ProviderInstanceId.make("codex"),
          ProviderInstanceId.make("codex_personal"),
          ProviderInstanceId.make("codex_personal_alias"),
        ]);
        assert.deepStrictEqual(workSource.instanceIds, [ProviderInstanceId.make("codex_work")]);

        const codexBuckets = modern.buckets.filter((bucket) => bucket.provider === "codex");
        assert.strictEqual(totalOutputTokens({ buckets: codexBuckets }), 12);
        assert.isTrue(codexBuckets.every((bucket) => bucket.sourceId !== undefined));
        assert.isTrue(codexBuckets.every((bucket) => bucket.hourStart !== undefined));
        for (const bucket of codexBuckets) {
          assert.isTrue(codexSources.some((source) => source.sourceId === bucket.sourceId));
        }
      }).pipe(Effect.scoped),
  );

  it.live(
    "resolves configured homes by provider precedence and reports unsupported, unavailable, disabled, and missing instances",
    () =>
      Effect.gen(function* () {
        const { home } = yield* setup;
        const roots = {
          claudeExplicit: NodePath.join(home, "claude-explicit"),
          claudeInstanceEnv: NodePath.join(home, "claude-instance-env"),
          claudeHostEnv: NodePath.join(home, "claude-host-env"),
          codexInherited: NodePath.join(home, "codex-inherited"),
          codexInstanceEnv: NodePath.join(home, "codex-instance-env"),
          codexExplicit: NodePath.join(home, "codex-explicit"),
          codexDisabled: NodePath.join(home, "codex-disabled"),
          grokHostEnv: NodePath.join(home, "grok-host-env"),
          grokInstanceEnv: NodePath.join(home, "grok-instance-env"),
        };
        const writeClaude = (root: string, name: string, tokens: number) =>
          Effect.promise(() => {
            const dir = NodePath.join(root, "projects", "proj");
            return NodeFSP.mkdir(dir, { recursive: true }).then(() =>
              NodeFSP.writeFile(NodePath.join(dir, name), claudeLine(tokens, tokens)),
            );
          });
        const writeCodex = (root: string, name: string, tokens: number) =>
          Effect.promise(() => {
            const dir = NodePath.join(root, "sessions");
            return NodeFSP.mkdir(dir, { recursive: true }).then(() =>
              NodeFSP.writeFile(NodePath.join(dir, name), codexTranscript(name, tokens)),
            );
          });
        const writeGrok = (root: string, tokens: number) =>
          Effect.promise(() => {
            const dir = NodePath.join(root, "sessions");
            return NodeFSP.mkdir(dir, { recursive: true }).then(() =>
              NodeFSP.writeFile(
                NodePath.join(dir, "updates.jsonl"),
                grokTranscript("grok-session", tokens),
              ),
            );
          });

        yield* writeClaude(roots.claudeExplicit, "explicit.jsonl", 3);
        yield* writeClaude(roots.claudeExplicit, "explicit-copy.jsonl", 3);
        yield* writeClaude(roots.claudeInstanceEnv, "instance.jsonl", 3);
        yield* writeClaude(roots.claudeHostEnv, "host.jsonl", 5);
        yield* writeCodex(roots.codexInherited, "inherited.jsonl", 6);
        yield* writeCodex(roots.codexInstanceEnv, "instance.jsonl", 7);
        yield* writeCodex(roots.codexExplicit, "explicit.jsonl", 8);
        yield* writeCodex(roots.codexDisabled, "disabled.jsonl", 9);
        yield* writeGrok(roots.grokHostEnv, 10);
        yield* writeGrok(roots.grokInstanceEnv, 11);

        const settings = {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            claude_explicit: providerInstance(
              "claudeAgent",
              { homePath: roots.claudeExplicit },
              { environment: providerEnvironment("CLAUDE_CONFIG_DIR", "relative-claude-instance") },
            ),
            claude_instance_env: providerInstance(
              "claudeAgent",
              {},
              {
                environment: providerEnvironment("CLAUDE_CONFIG_DIR", roots.claudeInstanceEnv),
              },
            ),
            claude_relative: providerInstance(
              "claudeAgent",
              {},
              {
                environment: providerEnvironment("CLAUDE_CONFIG_DIR", "relative-claude-home"),
              },
            ),
            claude_invalid: providerInstance("claudeAgent", { homePath: 42 }),
            claude_host_fallback: providerInstance("claudeAgent", {}),
            codex_inherited: providerInstance("codex", {}),
            codex_instance_env: providerInstance(
              "codex",
              {},
              {
                environment: providerEnvironment("CODEX_HOME", roots.codexInstanceEnv),
              },
            ),
            codex_explicit: providerInstance(
              "codex",
              { homePath: roots.codexExplicit },
              {
                environment: providerEnvironment(
                  "CODEX_HOME",
                  NodePath.join(home, "codex-shadowed-by-config"),
                ),
              },
            ),
            codex_relative: providerInstance(
              "codex",
              {},
              {
                environment: providerEnvironment("CODEX_HOME", "relative-codex-home"),
              },
            ),
            codex_disabled: providerInstance(
              "codex",
              { homePath: roots.codexDisabled },
              { enabled: false },
            ),
            codex_missing: providerInstance("codex", {
              homePath: NodePath.join(home, "codex-missing"),
            }),
            grok_instance_env: providerInstance(
              "grok",
              {},
              {
                environment: providerEnvironment("GROK_HOME", roots.grokInstanceEnv),
              },
            ),
            grok_relative: providerInstance(
              "grok",
              {},
              {
                environment: providerEnvironment("GROK_HOME", "relative-grok-home"),
              },
            ),
            unknown_disabled: providerInstance("futureDriver", {}, { enabled: false }),
            cursor_disabled: providerInstance(
              "cursor",
              {},
              { enabled: false, displayName: "Cursor Archive" },
            ),
          },
        };
        const service = yield* UsageService.make.pipe(
          Effect.provide(
            serviceLayers({
              prefix: "usage-service-configured-precedence-test",
              home,
              settings,
              environment: {
                CLAUDE_CONFIG_DIR: roots.claudeHostEnv,
                CODEX_HOME: roots.codexInherited,
                GROK_HOME: roots.grokHostEnv,
              },
            }),
          ),
        );
        const summary = yield* service.readSummary({ ...WINDOW, includeProviderInstances: true });
        const roster = new Map(
          summary.providerInstances?.map((instance) => [instance.instanceId, instance]),
        );
        const sources = new Map(summary.sources.map((source) => [source.sourceId, source]));
        const sourceFor = (instanceId: string) =>
          summary.sources.find((source) =>
            source.instanceIds?.includes(ProviderInstanceId.make(instanceId)),
          );
        const resolvedRoot = (instanceId: string) =>
          sourceFor(instanceId)?.fingerprint.resolvedHomePath;
        const rootPaths = [
          ["claude_explicit", NodePath.join(roots.claudeExplicit, "projects")],
          ["claude_instance_env", NodePath.join(roots.claudeInstanceEnv, "projects")],
          ["claude_host_fallback", NodePath.join(roots.claudeHostEnv, "projects")],
          ["codex_instance_env", NodePath.join(roots.codexInstanceEnv, "sessions")],
          ["codex_inherited", NodePath.join(roots.codexInherited, "sessions")],
          ["codex_explicit", NodePath.join(roots.codexExplicit, "sessions")],
          ["grok_instance_env", NodePath.join(roots.grokInstanceEnv, "sessions")],
          ["grok", NodePath.join(roots.grokHostEnv, "sessions")],
        ] as const;
        const expectedRoots = new Map(
          yield* Effect.promise(() =>
            Promise.all(
              rootPaths.map(
                async ([instanceId, root]) => [instanceId, await NodeFSP.realpath(root)] as const,
              ),
            ),
          ),
        );

        assert.strictEqual(resolvedRoot("claude_explicit"), expectedRoots.get("claude_explicit"));
        assert.strictEqual(
          resolvedRoot("claude_instance_env"),
          expectedRoots.get("claude_instance_env"),
        );
        assert.strictEqual(
          resolvedRoot("claude_host_fallback"),
          expectedRoots.get("claude_host_fallback"),
        );
        assert.strictEqual(sourceFor("claude_explicit")?.scannedFiles, 2);
        assert.isUndefined(sourceFor("claude_relative"));
        assert.isUndefined(sourceFor("claude_invalid"));

        assert.strictEqual(
          resolvedRoot("codex_instance_env"),
          expectedRoots.get("codex_instance_env"),
        );
        assert.strictEqual(resolvedRoot("codex_inherited"), expectedRoots.get("codex_inherited"));
        assert.strictEqual(resolvedRoot("codex_explicit"), expectedRoots.get("codex_explicit"));
        assert.isUndefined(sourceFor("codex_relative"));
        assert.strictEqual(sourceFor("codex_missing")?.status, "missing");
        assert.strictEqual(sourceFor("codex_disabled")?.status, "ok");
        assert.strictEqual(
          resolvedRoot("grok_instance_env"),
          expectedRoots.get("grok_instance_env"),
        );
        assert.strictEqual(resolvedRoot("grok"), expectedRoots.get("grok"));
        assert.isUndefined(sourceFor("grok_relative"));

        assert.strictEqual(
          roster.get(ProviderInstanceId.make("cursor_disabled"))?.coverage,
          "unsupported",
        );
        assert.strictEqual(roster.get(ProviderInstanceId.make("cursor_disabled"))?.enabled, false);
        assert.strictEqual(
          roster.get(ProviderInstanceId.make("unknown_disabled"))?.coverage,
          "unsupported",
        );
        assert.strictEqual(roster.get(ProviderInstanceId.make("unknown_disabled"))?.enabled, false);
        for (const instanceId of [
          "cursor",
          "opencode",
          "antigravity",
          "cursor_disabled",
          "unknown_disabled",
        ]) {
          assert.strictEqual(
            roster.get(ProviderInstanceId.make(instanceId))?.coverage,
            "unsupported",
          );
          assert.isUndefined(sourceFor(instanceId));
        }
        assert.strictEqual(
          roster.get(ProviderInstanceId.make("claude_relative"))?.coverage,
          "unavailable",
        );
        assert.strictEqual(
          roster.get(ProviderInstanceId.make("claude_invalid"))?.coverage,
          "unavailable",
        );
        assert.strictEqual(
          roster.get(ProviderInstanceId.make("codex_missing"))?.coverage,
          "supported",
        );
        assert.strictEqual(roster.get(ProviderInstanceId.make("codex_disabled"))?.enabled, false);
        assert.strictEqual(
          roster.get(ProviderInstanceId.make("codex_disabled"))?.coverage,
          "supported",
        );
        assert.isTrue(
          summary.buckets.every(
            (bucket) => bucket.sourceId !== undefined && sources.has(bucket.sourceId),
          ),
        );
        assert.isTrue(
          summary.sources.every(
            (source) => source.sourceId !== undefined && source.instanceIds !== undefined,
          ),
        );
        assert.strictEqual(totalOutputTokens(summary), 62);
      }).pipe(Effect.scoped),
  );

  it.live("refetches a rate table inside its TTL only when the client asks", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));

      let ratesFetches = 0;
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-service-rates-refresh-test",
            home,
            settings,
            ratesDocument: {
              "claude-fable-5": { input_cost_per_token: 1e-5, output_cost_per_token: 5e-5 },
            },
            onRatesFetch: () => {
              ratesFetches += 1;
            },
          }),
        ),
      );

      const first = yield* service.readSummary(WINDOW);
      assert.strictEqual(ratesFetches, 1);
      assert.strictEqual(first.pricing.status, "fresh");

      // Inside the daily TTL a plain rescan keeps the cached table.
      yield* TestClock.adjust(Duration.minutes(2));
      yield* service.readSummary(WINDOW);
      assert.strictEqual(ratesFetches, 1);

      // An explicit refresh fetches again so a newly listed model gets priced.
      // A burst of refreshes shares that one fetch.
      const [refreshed] = yield* Effect.all([service.refreshRates, service.refreshRates], {
        concurrency: 2,
      });
      assert.strictEqual(ratesFetches, 2);
      assert.strictEqual(refreshed.status, "fresh");
      assert.strictEqual(refreshed.knownModels, 1);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.live("does not orphan an in-flight scan when its first caller is interrupted", () =>
    Effect.gen(function* () {
      const { settings, home } = yield* setup;
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({ prefix: "usage-service-interruption-test", home, settings }),
        ),
      );

      let orphanedAt: number | undefined;
      for (let interruptAt = 1; interruptAt <= 31; interruptAt += 1) {
        const tasks: Array<() => void> = [];
        const dispatcher: Scheduler.SchedulerDispatcher = {
          scheduleTask: (task) => tasks.push(task),
          flush: () => {
            let task: (() => void) | undefined;
            while ((task = tasks.shift()) !== undefined) task();
          },
        };

        let requestFiber: Fiber.Fiber<unknown, unknown> | undefined;
        let requestChecks = 0;
        const scheduler: Scheduler.Scheduler = {
          executionMode: "async",
          makeDispatcher: () => dispatcher,
          shouldYield: (fiber) => {
            if (fiber !== requestFiber) return false;
            requestChecks += 1;
            if (requestChecks !== interruptAt) return false;
            fiber.interruptUnsafe();
            return true;
          },
        };

        // Each candidate needs a distinct key because the broken case leaves
        // its entry in the service's private in-flight map. The invalid window
        // keeps the real scan synchronous once its detached fiber starts.
        const input: UsageSummaryInput = {
          ...WINDOW,
          sinceDay: UsageDay.make("2026-09-01"),
          untilDay: UsageDay.make(`2026-08-${String(interruptAt).padStart(2, "0")}`),
        };
        const first = yield* service
          .readSummary(input)
          .pipe(
            Effect.exit,
            Effect.provideService(Scheduler.Scheduler, scheduler),
            Effect.forkChild,
          );
        requestFiber = first;
        yield* Effect.yieldNow;
        dispatcher.flush();

        const second = yield* service.readSummary(input).pipe(
          Effect.match({
            onFailure: (error) => error.reason,
            onSuccess: () => "success" as const,
          }),
          Effect.provideService(Scheduler.Scheduler, scheduler),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        dispatcher.flush();
        const secondExit = second.pollUnsafe();
        if (secondExit === undefined) {
          second.interruptUnsafe();
          orphanedAt = interruptAt;
          break;
        }
        if (Exit.isFailure(secondExit)) {
          assert.fail("the matching request fiber was interrupted");
        }
        assert.strictEqual(secondExit.value, "invalidWindow");
      }

      assert.isUndefined(
        orphanedAt,
        `interruption left the next matching request pending at scheduler check ${orphanedAt}`,
      );
    }).pipe(Effect.scoped),
  );
});
