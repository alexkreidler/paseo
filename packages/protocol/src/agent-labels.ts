export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
export const FORK_SOURCE_AGENT_ID_LABEL = "paseo.fork-source-agent-id";
export const FORK_SOURCE_MESSAGE_ID_LABEL = "paseo.fork-source-message-id";

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function getForkSourceFromLabels(
  labels: Record<string, unknown> | null | undefined,
): { agentId: string; messageId: string } | null {
  const agentId = labels?.[FORK_SOURCE_AGENT_ID_LABEL];
  const messageId = labels?.[FORK_SOURCE_MESSAGE_ID_LABEL];
  if (
    typeof agentId === "string" &&
    agentId.trim().length > 0 &&
    typeof messageId === "string" &&
    messageId.trim().length > 0
  ) {
    return { agentId: agentId.trim(), messageId: messageId.trim() };
  }
  return null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}
