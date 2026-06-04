import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { AgentManager } from "../agent-manager.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentProvider,
  AgentRunResult,
  AgentSession,
  AgentStreamEvent,
  AgentSessionConfig,
  AgentTimelineItem,
  ForkResult,
  ListModelsOptions,
} from "../agent-sdk-types.js";

const FORK_TEST_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
  supportsRewindConversation: true,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
  supportsForkConversation: true,
};

const NO_FORK_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

interface RecordedFork {
  messageId: string;
}

class FakeForkSession implements AgentSession {
  readonly provider: AgentProvider = "claude";
  readonly id = "fake-fork-session";
  readonly capabilities: AgentCapabilityFlags;
  readonly recordedForks: RecordedFork[] = [];
  aborted = false;
  historyReadCount = 0;
  history: AgentTimelineItem[] = [
    { type: "user_message", text: "prompt 1", messageId: "msg-1" },
    { type: "assistant_message", text: "response 1", messageId: "msg-2" },
    { type: "user_message", text: "prompt 2", messageId: "msg-3" },
    { type: "assistant_message", text: "response 2", messageId: "msg-4" },
    { type: "user_message", text: "prompt 3", messageId: "msg-5" },
    { type: "assistant_message", text: "response 3", messageId: "msg-6" },
  ];

  private subscribers = new Set<(event: AgentStreamEvent) => void>();
  private activeTurnId: string | null = null;

  constructor(capabilities?: AgentCapabilityFlags) {
    this.capabilities = capabilities ?? FORK_TEST_CAPABILITIES;
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(): Promise<{ turnId: string }> {
    this.aborted = false;
    this.activeTurnId = "turn-1";
    queueMicrotask(() => {
      this.emit({ type: "turn_started", provider: this.provider, turnId: "turn-1" });
    });
    return { turnId: "turn-1" };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    this.historyReadCount += 1;
    for (const item of this.history) {
      yield { type: "timeline", provider: this.provider, item };
    }
  }

  async getRuntimeInfo() {
    return { provider: this.provider, sessionId: this.id };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode() {
    return null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(
    _requestId: string,
    _response: AgentPermissionResponse,
  ): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {
    this.aborted = true;
    if (this.activeTurnId) {
      const turnId = this.activeTurnId;
      this.activeTurnId = null;
      this.emit({ type: "turn_canceled", provider: this.provider, reason: "interrupted", turnId });
    }
  }

  async close(): Promise<void> {}

  async forkConversation(input: { messageId: string }): Promise<ForkResult> {
    this.recordedForks.push({ messageId: input.messageId });
    return {
      sessionHandle: {
        provider: this.provider,
        sessionId: "forked-session-id",
        nativeHandle: "forked-session-id",
        metadata: {},
      },
    };
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}

import { randomUUID } from "node:crypto";

let nextId = 900;

class FakeForkClient implements AgentClient {
  readonly provider = "claude";
  readonly capabilities: AgentCapabilityFlags;

  constructor(readonly session: FakeForkSession) {
    this.capabilities = session.capabilities;
  }

  async createSession(_config: AgentSessionConfig): Promise<AgentSession> {
    return this.session;
  }

  async resumeSession(): Promise<AgentSession> {
    return new FakeForkSession(this.session.capabilities);
  }

  async listModels(_options: ListModelsOptions) {
    return [];
  }

  async isAvailable() {
    return true;
  }
}

async function createForkHarness(capabilities?: AgentCapabilityFlags) {
  const session = new FakeForkSession(capabilities);
  nextId += 1;
  const manager = new AgentManager({
    clients: { claude: new FakeForkClient(session) },
    logger: createTestLogger(),
    idFactory: () => randomUUID(),
  });
  const agent = await manager.createAgent({
    provider: "claude",
    cwd: process.cwd(),
  });

  await manager.hydrateTimelineFromProvider(agent.id, { force: true });

  return { manager, session, agentId: agent.id };
}

describe("fork capability", () => {
  test("invokes provider forkConversation and creates a new agent", async () => {
    const { manager, session, agentId } = await createForkHarness();

    const result = await manager.forkConversation(agentId, "msg-3");

    expect(session.recordedForks).toEqual([{ messageId: "msg-3" }]);
    expect(result.sourceAgentId).toBe(agentId);
    expect(result.forkedAgentId).toBeTruthy();
    expect(result.forkedAgentId).not.toBe(agentId);
  });

  test("forked agent timeline is hydrated from provider", async () => {
    const { manager, agentId } = await createForkHarness();

    const result = await manager.forkConversation(agentId, "msg-3");

    const forkedTimeline = manager.fetchTimeline(result.forkedAgentId, { limit: 0 });
    expect(forkedTimeline.rows.length).toBeGreaterThan(0);
  });

  test("source agent timeline is untouched after fork", async () => {
    const { manager, agentId } = await createForkHarness();

    const beforeTimeline = manager.fetchTimeline(agentId, { limit: 0 });
    const beforeCount = beforeTimeline.rows.length;

    await manager.forkConversation(agentId, "msg-3");

    const afterTimeline = manager.fetchTimeline(agentId, { limit: 0 });
    expect(afterTimeline.rows.length).toBe(beforeCount);
  });

  test("forked agent has fork lineage labels", async () => {
    const { manager, agentId } = await createForkHarness();

    const result = await manager.forkConversation(agentId, "msg-3");

    const forkedAgent = manager.getAgent(result.forkedAgentId);
    expect(forkedAgent).toBeTruthy();
    expect(forkedAgent!.labels["paseo.fork-source-agent-id"]).toBe(agentId);
    expect(forkedAgent!.labels["paseo.fork-source-message-id"]).toBe("msg-3");
  });

  test("throws ForkCapabilityError when provider does not support fork", async () => {
    const { manager, agentId } = await createForkHarness(NO_FORK_CAPABILITIES);

    await expect(manager.forkConversation(agentId, "msg-3")).rejects.toThrow(
      "Provider does not support forking conversations",
    );
  });

  test("cancels active run before forking", async () => {
    const { manager, session, agentId } = await createForkHarness();
    const run = manager.streamAgent(agentId, "keep working");
    await run.next();

    await manager.forkConversation(agentId, "msg-3");

    expect(session.aborted).toBe(true);
    expect(session.recordedForks).toEqual([{ messageId: "msg-3" }]);
  });
});
