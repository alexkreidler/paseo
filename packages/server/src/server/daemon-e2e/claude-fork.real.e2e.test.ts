import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import type { AgentTimelineItem } from "../agent/agent-sdk-types.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import {
  canRunRealProvider,
  createRealProviderClients,
  getRealProviderConfig,
} from "./real-provider-test-config.js";
import {
  closeRewindSession,
  fetchTimelineItems,
  tmpRewindCwd,
  userMessageIdForToken,
} from "./test-utils/rewind-helpers.js";

const TURN_TIMEOUT_MS = 180_000;

interface ForkHarness {
  client: DaemonClient;
  daemon: TestPaseoDaemon;
}

interface ForkSession {
  agentId: string;
  cwd: string;
}

describe("daemon E2E (real claude) - fork conversation", () => {
  let canRun = false;
  let harness: ForkHarness;

  beforeAll(async () => {
    canRun = await canRunRealProvider("claude");
    if (!canRun) {
      return;
    }
    const logger = pino({ level: "warn" });
    const daemon = await createTestPaseoDaemon({
      agentClients: createRealProviderClients(["claude"], logger),
      logger,
    });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.1.90",
    });
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "claude-fork-real" } });
    harness = { client, daemon };
  }, 30_000);

  afterAll(async () => {
    await harness?.client.close().catch(() => undefined);
    await harness?.daemon.close().catch(() => undefined);
  });

  beforeEach((context) => {
    if (!canRun) {
      context.skip();
    }
  });

  async function launchSession(title: string): Promise<ForkSession> {
    const cwd = tmpRewindCwd("daemon-real-claude-fork-");
    const agent = await harness.client.createAgent({
      cwd,
      title,
      ...getRealProviderConfig("claude"),
    });
    return { agentId: agent.id, cwd };
  }

  async function sendReplyTurn(session: ForkSession, prompt: string): Promise<void> {
    await harness.client.sendMessage(session.agentId, prompt);
    const finish = await harness.client.waitForFinish(session.agentId, TURN_TIMEOUT_MS);
    expect(finish.status).toBe("idle");
    expect(finish.final?.lastError).toBeUndefined();
  }

  test("forks at second user message, new agent has truncated timeline and accepts prompts", async () => {
    const session = await launchSession("claude-fork-3-turn");

    try {
      await sendReplyTurn(session, "PASEO_FORK_T1. Say only: PASEO_FORK_T1_DONE");
      await sendReplyTurn(session, "PASEO_FORK_T2. Say only: PASEO_FORK_T2_DONE");
      await sendReplyTurn(session, "PASEO_FORK_T3. Say only: PASEO_FORK_T3_DONE");

      const beforeItems = await fetchTimelineItems(harness.client, session.agentId);
      const sourceUserMessages = beforeItems.filter((i) => i.type === "user_message");
      expect(sourceUserMessages.length).toBe(3);

      const forkMessageId = userMessageIdForToken(beforeItems, "PASEO_FORK_T2");

      const sourceSessionId = (await harness.client.fetchAgent(session.agentId))?.agent.runtimeInfo
        ?.sessionId;

      // Fork at the second user message
      const forkResult = await harness.client.forkAgent(session.agentId, forkMessageId);
      expect(forkResult.ok).toBe(true);
      expect(forkResult.sourceAgentId).toBe(session.agentId);
      expect(forkResult.forkedAgentId).toBeTruthy();

      // Verify forked agent has lineage labels
      const forkedSnapshot = await harness.client.fetchAgent(forkResult.forkedAgentId!);
      expect(forkedSnapshot?.agent.labels?.["paseo.fork-source-agent-id"]).toBe(session.agentId);
      expect(forkedSnapshot?.agent.labels?.["paseo.fork-source-message-id"]).toBe(forkMessageId);
      expect(forkedSnapshot?.agent.status).toBe("idle");

      // Forked agent has a different session ID (provider forked the session)
      const forkedSessionId = forkedSnapshot?.agent.runtimeInfo?.sessionId;
      expect(forkedSessionId).toBeTruthy();
      expect(forkedSessionId).not.toBe(sourceSessionId);

      // Source agent is untouched — still has all 3 turns
      const sourceAfterItems = await fetchTimelineItems(harness.client, session.agentId);
      const sourceAfterUserMessages = sourceAfterItems.filter((i) => i.type === "user_message");
      expect(sourceAfterUserMessages.length).toBe(3);

      const sourceAfterSnapshot = await harness.client.fetchAgent(session.agentId);
      expect(sourceAfterSnapshot?.agent.status).toBe("idle");
      expect(sourceAfterSnapshot?.agent.runtimeInfo?.sessionId).toBe(sourceSessionId);

      // Forked agent timeline has messages from the provider
      const forkedItems = await fetchTimelineItems(harness.client, forkResult.forkedAgentId!);
      expect(forkedItems.length).toBeGreaterThan(0);
      const forkedUserMessages = forkedItems.filter(
        (i: AgentTimelineItem) => i.type === "user_message",
      );
      // Forked session should have user messages up to the fork point (T1 and T2, not T3)
      expect(forkedUserMessages.length).toBeLessThanOrEqual(2);
      expect(forkedUserMessages.length).toBeGreaterThanOrEqual(1);

      // Forked agent accepts a diverging prompt
      await harness.client.sendMessage(
        forkResult.forkedAgentId!,
        "PASEO_FORK_DIVERGE. Say only: PASEO_FORK_DIVERGE_DONE",
      );
      const forkedFinish = await harness.client.waitForFinish(
        forkResult.forkedAgentId!,
        TURN_TIMEOUT_MS,
      );
      expect(forkedFinish.status).toBe("idle");
      expect(forkedFinish.final?.lastError).toBeUndefined();

      const finalForkedItems = await fetchTimelineItems(harness.client, forkResult.forkedAgentId!);
      const finalForkedUserMessages = finalForkedItems.filter(
        (i: AgentTimelineItem) => i.type === "user_message",
      );
      expect(finalForkedUserMessages.length).toBeGreaterThan(forkedUserMessages.length);
    } finally {
      closeRewindSession(session);
    }
  }, 420_000);
});
