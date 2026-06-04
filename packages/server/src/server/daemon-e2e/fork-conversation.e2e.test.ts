import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentFeature,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
  ForkResult,
  ListModelsOptions,
} from "../agent/agent-sdk-types.js";

const FORK_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
  supportsForkConversation: true,
};

class ForkableSession implements AgentSession {
  readonly provider = "claude";
  readonly capabilities = FORK_CAPABILITIES;
  readonly features: AgentFeature[] = [];
  readonly id: string;

  private subscribers = new Set<(event: AgentStreamEvent) => void>();
  private turnCount = 0;
  private history: AgentTimelineItem[] = [];
  private activeTurnId: string | null = null;
  private client: ForkableClient | null;

  constructor(sessionId?: string, seedHistory?: AgentTimelineItem[], client?: ForkableClient) {
    this.id = sessionId ?? randomUUID();
    this.client = client ?? null;
    if (seedHistory) {
      this.history = [...seedHistory];
    }
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    this.turnCount += 1;
    const turnId = `turn-${this.turnCount}`;
    this.activeTurnId = turnId;

    const text = typeof prompt === "string" ? prompt : "complex prompt";
    const userMsgId = randomUUID();
    const assistantMsgId = randomUUID();

    queueMicrotask(() => {
      this.emit({ type: "turn_started", provider: "claude", turnId });
      this.emit({
        type: "timeline",
        provider: "claude",
        turnId,
        item: { type: "user_message", text, messageId: userMsgId },
      });

      setTimeout(() => {
        this.history.push({ type: "user_message", text, messageId: userMsgId });
        this.history.push({
          type: "assistant_message",
          text: `Echo: ${text}`,
          messageId: assistantMsgId,
        });

        this.emit({
          type: "timeline",
          provider: "claude",
          turnId,
          item: { type: "assistant_message", text: `Echo: ${text}`, messageId: assistantMsgId },
        });
        this.emit({ type: "turn_completed", provider: "claude", turnId });
        this.activeTurnId = null;
      }, 50);
    });

    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const item of this.history) {
      yield { type: "timeline", provider: "claude", item };
    }
  }

  async getRuntimeInfo() {
    return { provider: "claude" as const, sessionId: this.id };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
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
    return {
      provider: "claude",
      sessionId: this.id,
      nativeHandle: this.id,
      metadata: {},
    };
  }

  async interrupt(): Promise<void> {
    if (this.activeTurnId) {
      const turnId = this.activeTurnId;
      this.activeTurnId = null;
      this.emit({ type: "turn_canceled", provider: "claude", reason: "interrupted", turnId });
    }
  }

  async close(): Promise<void> {}

  async forkConversation(input: { messageId: string }): Promise<ForkResult> {
    const forkedSessionId = randomUUID();
    const forkedHistory: AgentTimelineItem[] = [];
    for (const item of this.history) {
      forkedHistory.push(item);
      if (
        (item.type === "user_message" || item.type === "assistant_message") &&
        item.messageId === input.messageId
      ) {
        break;
      }
    }
    this.client?.registerForkedHistory(forkedSessionId, forkedHistory);
    return {
      sessionHandle: {
        provider: "claude",
        sessionId: forkedSessionId,
        nativeHandle: forkedSessionId,
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

class ForkableClient implements AgentClient {
  readonly provider = "claude";
  readonly capabilities = FORK_CAPABILITIES;
  private readonly forkedHistories = new Map<string, AgentTimelineItem[]>();

  registerForkedHistory(sessionId: string, history: AgentTimelineItem[]): void {
    this.forkedHistories.set(sessionId, history);
  }

  async createSession(_config: AgentSessionConfig): Promise<AgentSession> {
    return new ForkableSession(undefined, undefined, this);
  }

  async resumeSession(handle: AgentPersistenceHandle): Promise<AgentSession> {
    const history = this.forkedHistories.get(handle.sessionId);
    this.forkedHistories.delete(handle.sessionId);
    return new ForkableSession(handle.sessionId, history);
  }

  async listModels(_options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    return [];
  }

  async isAvailable() {
    return true;
  }
}

describe("fork conversation E2E", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;

  beforeEach(async () => {
    daemon = await createTestPaseoDaemon({
      agentClients: { claude: new ForkableClient() },
    });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.1.90",
    });
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "test" } });
  });

  afterEach(async () => {
    await client.close();
    await daemon.close();
  }, 60000);

  test("forks a conversation and creates a new agent with lineage labels", async () => {
    const agent = await client.createAgent({ provider: "claude", cwd: "/tmp" });

    await client.sendMessage(agent.id, "first message");
    await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 15_000);

    await client.sendMessage(agent.id, "second message");
    await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 15_000);

    await client.sendMessage(agent.id, "third message");
    await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 15_000);

    // Fetch timeline to find a messageId
    const timeline = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      projection: "canonical",
    });
    const userMessages = timeline.entries.filter((e) => e.item.type === "user_message");
    expect(userMessages.length).toBe(3);

    const secondUserMsg = userMessages[1].item as { messageId?: string };
    expect(secondUserMsg.messageId).toBeTruthy();
    const forkAtMessageId = secondUserMsg.messageId!;

    // Fork the conversation
    const forkResult = await client.forkAgent(agent.id, forkAtMessageId);
    expect(forkResult.ok).toBe(true);
    expect(forkResult.sourceAgentId).toBe(agent.id);
    expect(forkResult.forkedAgentId).toBeTruthy();
    expect(forkResult.forkedAgentId).not.toBe(agent.id);

    // Verify forked agent has fork lineage labels
    const forkedResult = await client.fetchAgent(forkResult.forkedAgentId!);
    expect(forkedResult).toBeTruthy();
    expect(forkedResult!.agent.labels?.["paseo.fork-source-agent-id"]).toBe(agent.id);
    expect(forkedResult!.agent.labels?.["paseo.fork-source-message-id"]).toBe(forkAtMessageId);
    expect(forkedResult!.agent.status).toBe("idle");
  }, 60000);

  test("forked agent timeline is seeded up to the fork point", async () => {
    const agent = await client.createAgent({ provider: "claude", cwd: "/tmp" });

    await client.sendMessage(agent.id, "first");
    await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 15_000);

    await client.sendMessage(agent.id, "second");
    await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 15_000);

    await client.sendMessage(agent.id, "third");
    await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 15_000);

    const timeline = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      projection: "canonical",
    });
    const userMessages = timeline.entries.filter((e) => e.item.type === "user_message");
    const forkAtMessageId = (userMessages[1].item as { messageId: string }).messageId;

    const forkResult = await client.forkAgent(agent.id, forkAtMessageId);

    // Forked agent timeline should have entries from the provider
    const forkedTimeline = await client.fetchAgentTimeline(forkResult.forkedAgentId!, {
      direction: "tail",
      projection: "canonical",
    });
    expect(forkedTimeline.entries.length).toBeGreaterThan(0);
  }, 60000);

  test("source agent is untouched after fork", async () => {
    const agent = await client.createAgent({ provider: "claude", cwd: "/tmp" });

    await client.sendMessage(agent.id, "first");
    await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 15_000);

    await client.sendMessage(agent.id, "second");
    await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 15_000);

    const beforeTimeline = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      projection: "canonical",
    });

    const firstUserMsg = beforeTimeline.entries.find((e) => e.item.type === "user_message");
    const forkAtMessageId = (firstUserMsg!.item as { messageId: string }).messageId;

    await client.forkAgent(agent.id, forkAtMessageId);

    // Source timeline should be unchanged
    const afterTimeline = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      projection: "canonical",
    });
    expect(afterTimeline.entries.length).toBe(beforeTimeline.entries.length);

    // Source agent should still be idle
    const sourceResult = await client.fetchAgent(agent.id);
    expect(sourceResult!.agent.status).toBe("idle");
  }, 60000);

  test("forked agent accepts new prompts that diverge from source", async () => {
    const agent = await client.createAgent({ provider: "claude", cwd: "/tmp" });

    await client.sendMessage(agent.id, "original prompt");
    await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 15_000);

    const timeline = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      projection: "canonical",
    });
    const userMsg = timeline.entries.find((e) => e.item.type === "user_message");
    const forkAtMessageId = (userMsg!.item as { messageId: string }).messageId;

    const forkResult = await client.forkAgent(agent.id, forkAtMessageId);

    // Send a diverging prompt to the forked agent
    await client.sendMessage(forkResult.forkedAgentId!, "diverging prompt");
    const forkedState = await client.waitForAgentUpsert(
      forkResult.forkedAgentId!,
      (s) => s.status === "idle",
      15_000,
    );

    expect(forkedState.status).toBe("idle");

    // Forked agent should have more entries than source
    const forkedTimeline = await client.fetchAgentTimeline(forkResult.forkedAgentId!, {
      direction: "tail",
      projection: "canonical",
    });
    const sourceTimeline = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      projection: "canonical",
    });
    expect(forkedTimeline.entries.length).toBeGreaterThan(sourceTimeline.entries.length);
  }, 60000);

  test("fork reports capability flag in agent snapshot", async () => {
    const agent = await client.createAgent({ provider: "claude", cwd: "/tmp" });
    expect(agent.capabilities.supportsForkConversation).toBe(true);
  });

  test("unsupported provider returns error on fork attempt", async () => {
    // Create a daemon with a client that doesn't support fork
    const noForkDaemon = await createTestPaseoDaemon();
    const noForkClient = new DaemonClient({
      url: `ws://127.0.0.1:${noForkDaemon.port}/ws`,
      appVersion: "0.1.90",
    });
    await noForkClient.connect();
    await noForkClient.fetchAgents({ subscribe: { subscriptionId: "test" } });

    try {
      const agent = await noForkClient.createAgent({ provider: "codex", cwd: "/tmp" });
      await expect(noForkClient.forkAgent(agent.id, "some-message-id")).rejects.toThrow(
        /does not support forking/,
      );
    } finally {
      await noForkClient.close();
      await noForkDaemon.close();
    }
  }, 60000);
});
