import type { AgentSession, ForkResult } from "../agent-sdk-types.js";

export class ForkCapabilityError extends Error {
  constructor() {
    super("Provider does not support forking conversations");
    this.name = "ForkCapabilityError";
  }
}

export async function invokeForkCapability(
  session: AgentSession,
  input: { messageId: string },
): Promise<ForkResult> {
  if (!session.capabilities.supportsForkConversation || !session.forkConversation) {
    throw new ForkCapabilityError();
  }
  return session.forkConversation({ messageId: input.messageId });
}
