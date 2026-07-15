import type { Logger } from "pino";
import type { SessionMode } from "@agentclientprotocol/sdk";

import type { AgentMode } from "../agent-sdk-types.js";
import type {
  ACPConfigFeatureOption,
  ACPProviderModeWriteResult,
  ACPProviderModeWriterContext,
  SessionStateResponse,
} from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface CursorACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

const CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;
const CURSOR_CLIENT_CAPABILITY_META = {
  parameterizedModelPicker: true,
};

export const CURSOR_FAST_FEATURE_OPTION: ACPConfigFeatureOption = {
  id: "fast",
  configId: "fast",
  label: "Fast",
  description: "Cursor fast mode",
  tooltip: "Select Cursor fast mode",
  icon: "zap",
};

export const CURSOR_FULL_ACCESS_MODE_ID = "full-access";

export const CURSOR_FULL_ACCESS_MODE: AgentMode = {
  id: CURSOR_FULL_ACCESS_MODE_ID,
  label: "Full Access",
  description: "Automatically approves every ACP tool permission. Only use in trusted workspaces.",
  icon: "ShieldOff",
  colorTier: "dangerous",
  isUnattended: true,
};

export class CursorACPAgentClient extends GenericACPAgentClient {
  constructor(options: CursorACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      // cursor-agent publishes slash commands asynchronously via available_commands_update.
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
      clientCapabilityMeta: CURSOR_CLIENT_CAPABILITY_META,
      configFeatureOptions: [CURSOR_FAST_FEATURE_OPTION],
      sessionResponseTransformer: addCursorFullAccessMode,
      providerModeWriter: writeCursorProviderMode,
      autoApprovePermissionModeId: CURSOR_FULL_ACCESS_MODE_ID,
    });
  }
}

export function addCursorFullAccessMode(response: SessionStateResponse): SessionStateResponse {
  const modeState = response.modes;
  const availableModes = modeState?.availableModes;
  const currentModeId = modeState?.currentModeId;
  if (!availableModes?.length || !currentModeId) {
    return response;
  }
  const fullAccessMode: SessionMode & Pick<AgentMode, "icon" | "colorTier" | "isUnattended"> = {
    id: CURSOR_FULL_ACCESS_MODE.id,
    name: CURSOR_FULL_ACCESS_MODE.label,
    description: CURSOR_FULL_ACCESS_MODE.description,
    icon: CURSOR_FULL_ACCESS_MODE.icon,
    colorTier: CURSOR_FULL_ACCESS_MODE.colorTier,
    isUnattended: CURSOR_FULL_ACCESS_MODE.isUnattended,
  };
  return {
    ...response,
    modes: {
      ...modeState,
      currentModeId,
      availableModes: availableModes
        .filter((mode) => mode.id !== CURSOR_FULL_ACCESS_MODE_ID)
        .concat(fullAccessMode),
    },
  };
}

export async function writeCursorProviderMode(
  context: ACPProviderModeWriterContext,
): Promise<ACPProviderModeWriteResult> {
  if (context.requestedModeId !== CURSOR_FULL_ACCESS_MODE_ID) {
    return { handled: false };
  }
  return {
    handled: true,
    currentModeId: CURSOR_FULL_ACCESS_MODE_ID,
  };
}
