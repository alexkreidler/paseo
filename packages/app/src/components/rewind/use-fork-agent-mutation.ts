import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { useToast } from "@/contexts/toast-context";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

interface UseForkAgentMutationInput {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  client?: DaemonClient | null;
}

export function useForkAgentMutation(input: UseForkAgentMutationInput): {
  forkAgent: () => Promise<void>;
  isPending: boolean;
} {
  const toast = useToast();
  const router = useRouter();
  const { isPending, mutateAsync } = useMutation({
    mutationFn: async () => {
      if (!input.client || !input.agentId || !input.messageId) {
        throw new Error("Daemon client not available");
      }
      return input.client.forkAgent(input.agentId, input.messageId);
    },
    onSuccess: (result) => {
      if (input.serverId && result.forkedAgentId) {
        const route = buildHostAgentDetailRoute(input.serverId, result.forkedAgentId);
        router.push(route as Href);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to branch conversation");
    },
  });

  const forkAgent = useCallback(async () => {
    if (isPending) {
      return;
    }
    await mutateAsync();
  }, [isPending, mutateAsync]);

  return {
    forkAgent,
    isPending,
  };
}
