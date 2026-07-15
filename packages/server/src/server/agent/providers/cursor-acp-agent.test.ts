import { describe, expect, test, vi } from "vitest";

import type { PermissionOption, RequestPermissionRequest } from "@agentclientprotocol/sdk";

import { ACPAgentSession, type SpawnedACPProcess, type SessionStateResponse } from "./acp-agent.js";
import {
  CURSOR_FAST_FEATURE_OPTION,
  CURSOR_FULL_ACCESS_MODE,
  CURSOR_FULL_ACCESS_MODE_ID,
  CursorACPAgentClient,
  writeCursorProviderMode,
} from "./cursor-acp-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

describe("CursorACPAgentClient model discovery", () => {
  function fastConfigOption(currentValue: "false" | "true") {
    return {
      id: "fast",
      name: "Fast",
      type: "select" as const,
      currentValue,
      options: [
        { value: "false", name: "Off" },
        { value: "true", name: "Fast" },
      ],
    };
  }
  class TestCursorACPAgentClient extends CursorACPAgentClient {
    constructor(response: SessionStateResponse) {
      super({
        logger: createTestLogger(),
        command: ["cursor-agent", "acp"],
      });
      this.response = response;
    }

    private readonly response: SessionStateResponse;

    protected override async spawnProcess(): Promise<SpawnedACPProcess> {
      return {
        child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
        connection: {
          newSession: vi.fn().mockResolvedValue(this.response),
        },
        initialize: { agentCapabilities: {} },
      } as SpawnedACPProcess;
    }

    protected override async closeProbe(): Promise<void> {}
  }

  function cursorSessionResponse(): SessionStateResponse {
    return {
      sessionId: "session-1",
      modes: {
        currentModeId: "agent",
        availableModes: [{ id: "agent", name: "Agent", description: null }],
      },
      models: null,
      configOptions: [],
    };
  }

  async function createCursorSession(modeId?: string): Promise<ACPAgentSession> {
    const session = new ACPAgentSession(
      {
        provider: "acp",
        cwd: "/tmp/cursor",
        modeId,
      },
      {
        provider: "acp",
        logger: createTestLogger(),
        defaultCommand: ["cursor-agent", "acp"],
        defaultModes: [],
        providerModeWriter: writeCursorProviderMode,
        autoApprovePermissionModeId: CURSOR_FULL_ACCESS_MODE_ID,
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: true,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
        },
      },
    );
    Object.assign(session, { sessionId: "session-1" });
    return session;
  }

  function permissionRequest(options: PermissionOption[]): RequestPermissionRequest {
    return {
      sessionId: "session-1",
      toolCall: {
        toolCallId: "web_search_0",
        title: "Web search: latest Node.js LTS",
        kind: "search",
        status: "pending",
      },
      options,
    };
  }

  test("returns only ACP model ids because Cursor CLI ids cannot select ACP models", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: {
        currentModelId: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
        availableModels: [
          {
            modelId: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
            name: "gpt-5.4",
            description: null,
          },
        ],
      },
      configOptions: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [
        {
          provider: "acp",
          id: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
          label: "gpt-5.4",
          description: undefined,
          isDefault: true,
          thinkingOptions: undefined,
          defaultThinkingOptionId: undefined,
        },
      ],
      modes: [],
    });
  });

  test("does not fall back to cursor-agent models when ACP reports zero models", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: null,
      configOptions: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [],
      modes: [],
    });
  });

  test("keeps modern Cursor models as plain ACP ids", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: {
        currentModelId: "composer-2.5",
        availableModels: [
          {
            modelId: "composer-2.5",
            name: "Composer 2.5",
            description: null,
          },
        ],
      },
      configOptions: [fastConfigOption("false")],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [
        {
          provider: "acp",
          id: "composer-2.5",
          label: "Composer 2.5",
          description: undefined,
          isDefault: true,
          thinkingOptions: undefined,
          defaultThinkingOptionId: undefined,
        },
      ],
      modes: [],
    });
  });

  test("exposes Cursor fast mode through provider features", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: null,
      configOptions: [fastConfigOption("false")],
    });

    await expect(
      client.listFeatures({
        provider: "acp",
        cwd: "/tmp/cursor",
      }),
    ).resolves.toEqual([
      {
        type: "select",
        id: CURSOR_FAST_FEATURE_OPTION.id,
        label: "Fast",
        description: "Cursor fast mode",
        tooltip: "Select Cursor fast mode",
        icon: "zap",
        value: "false",
        options: [
          {
            id: "false",
            label: "Off",
            isDefault: true,
            description: undefined,
            metadata: undefined,
          },
          {
            id: "true",
            label: "Fast",
            isDefault: false,
            description: undefined,
            metadata: undefined,
          },
        ],
      },
    ]);
  });

  test("advertises an explicit dangerous Full Access mode", async () => {
    const client = new TestCursorACPAgentClient(cursorSessionResponse());

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toMatchObject({
      modes: [
        { id: "agent", label: "Agent" },
        {
          id: CURSOR_FULL_ACCESS_MODE_ID,
          label: "Full Access",
          icon: "ShieldOff",
          colorTier: "dangerous",
          isUnattended: true,
        },
      ],
    });
  });

  test("passes permission requests through by default", async () => {
    const session = await createCursorSession();
    const permission = session.requestPermission(
      permissionRequest([
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        { optionId: "allow-once", name: "Allow", kind: "allow_once" },
      ]),
    );

    await Promise.resolve();

    const [pending] = session.getPendingPermissions();
    expect(pending).toEqual(expect.objectContaining({ name: "search", kind: "tool" }));

    await session.respondToPermission(pending!.id, { behavior: "allow" });
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
  });

  test("auto-selects a semantic allow option in Cursor Full Access mode", async () => {
    const session = await createCursorSession(CURSOR_FULL_ACCESS_MODE_ID);

    await expect(
      session.requestPermission(
        permissionRequest([
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          { optionId: "allow-always", name: "Always Allow", kind: "allow_always" },
        ]),
      ),
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-always" },
    });
    expect(session.getPendingPermissions()).toEqual([]);
  });

  test("keeps Cursor modes available after selecting Full Access", async () => {
    const session = await createCursorSession();
    Object.assign(session, {
      connection: {},
      currentMode: "agent",
      availableModes: [{ id: "agent", label: "Agent" }, CURSOR_FULL_ACCESS_MODE],
    });

    await session.setMode(CURSOR_FULL_ACCESS_MODE_ID);

    await expect(session.getCurrentMode()).resolves.toBe(CURSOR_FULL_ACCESS_MODE_ID);
    await expect(session.getAvailableModes()).resolves.toEqual([
      { id: "agent", label: "Agent" },
      CURSOR_FULL_ACCESS_MODE,
    ]);
  });

  test("keeps prompting in Full Access mode when ACP offers no allow option", async () => {
    const session = await createCursorSession(CURSOR_FULL_ACCESS_MODE_ID);
    const permission = session.requestPermission(
      permissionRequest([
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        { optionId: "cancel", name: "Cancel", kind: "reject_always" },
      ]),
    );

    await Promise.resolve();

    const [pending] = session.getPendingPermissions();
    expect(pending).toEqual(expect.objectContaining({ name: "search", kind: "tool" }));

    await session.respondToPermission(pending!.id, { behavior: "deny" });
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    });
  });
});
