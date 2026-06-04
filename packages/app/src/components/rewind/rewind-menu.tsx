import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { FileText, GitFork, Layers, MessageSquare, Undo2 } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type RewindMode, useRewindCapabilities } from "./use-rewind-capabilities";
import type { AgentCapabilityFlags } from "@getpaseo/protocol/agent-types";

export type { RewindMode };

interface RewindMenuProps {
  capabilities: AgentCapabilityFlags;
  rewoundText: string;
  onRewind: (input: { mode: RewindMode; rewoundText: string }) => Promise<void> | void;
  onFork?: () => Promise<void> | void;
  isPending?: boolean;
  isForkPending?: boolean;
  testID?: string;
}

function getIcon(mode: RewindMode, color: string): ReactElement {
  switch (mode) {
    case "conversation":
      return <MessageSquare size={16} color={color} />;
    case "files":
      return <FileText size={16} color={color} />;
    case "both":
      return <Layers size={16} color={color} />;
  }
}

export const RewindMenu = memo(function RewindMenu({
  capabilities,
  rewoundText,
  onRewind,
  onFork,
  isPending: isPendingProp = false,
  isForkPending = false,
  testID = "rewind-menu",
}: RewindMenuProps) {
  const { theme } = useUnistyles();
  const items = useRewindCapabilities(capabilities);
  const supportsFork = Boolean(capabilities.supportsForkConversation && onFork);
  const [isOpen, setIsOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<RewindMode | null>(null);
  const [isForkInFlight, setIsForkInFlight] = useState(false);
  const isLocked = isPendingProp || isForkPending || pendingMode !== null || isForkInFlight;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && pendingMode !== null) return;
      setIsOpen(next);
    },
    [pendingMode],
  );

  const handleSelect = useCallback(
    (mode: RewindMode) => async () => {
      if (isLocked) return;
      setPendingMode(mode);
      try {
        await onRewind({ mode, rewoundText });
      } catch {
        // useRewindAgentMutation owns the toast; the menu only owns flow state.
      } finally {
        setPendingMode(null);
        setIsOpen(false);
      }
    },
    [isLocked, onRewind, rewoundText],
  );

  const handleFork = useCallback(async () => {
    if (isLocked || !onFork) return;
    setIsForkInFlight(true);
    try {
      await onFork();
    } catch {
      // useForkAgentMutation owns the toast; the menu only owns flow state.
    } finally {
      setIsForkInFlight(false);
      setIsOpen(false);
    }
  }, [isLocked, onFork]);

  const triggerStyle = useCallback(
    () => [styles.trigger, isLocked ? styles.triggerDisabled : null],
    [isLocked],
  );

  const forkIcon = useMemo(
    () => <GitFork size={16} color={theme.colors.foreground} />,
    [theme.colors.foreground],
  );

  const tooltipContent = useMemo(
    () => (
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>Rewind to this message</Text>
      </TooltipContent>
    ),
    [],
  );

  if (items.length === 0 && !supportsFork) {
    return null;
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View style={styles.triggerSlot} collapsable={false}>
            <DropdownMenuTrigger
              accessibilityLabel="Rewind to this message"
              accessibilityRole="button"
              disabled={isLocked}
              style={triggerStyle}
              testID={`${testID}-trigger`}
            >
              {({ hovered, open }) => (
                <Undo2
                  size={16}
                  color={hovered || open ? theme.colors.foreground : theme.colors.foregroundMuted}
                />
              )}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        {tooltipContent}
      </Tooltip>
      <DropdownMenuContent align="end" minWidth={220} side="bottom" testID={`${testID}-content`}>
        {supportsFork ? (
          <>
            <DropdownMenuItem
              closeOnSelect={false}
              disabled={isLocked && !isForkInFlight}
              leading={forkIcon}
              onSelect={handleFork}
              status={isForkInFlight ? "pending" : undefined}
              testID="rewind-menu-fork"
            >
              Branch from here
            </DropdownMenuItem>
            {items.length > 0 ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {items.length > 0 ? (
          <>
            <View style={styles.warningHeader}>
              <Text style={styles.warningText}>This action cannot be undone</Text>
            </View>
            <DropdownMenuSeparator />
            {items.map((item) => (
              <DropdownMenuItem
                key={item.mode}
                closeOnSelect={false}
                disabled={isLocked && pendingMode !== item.mode}
                leading={getIcon(item.mode, theme.colors.foreground)}
                onSelect={handleSelect(item.mode)}
                status={pendingMode === item.mode ? "pending" : undefined}
                testID={item.testID}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  triggerDisabled: {
    opacity: theme.opacity[50],
  },
  triggerSlot: {
    alignSelf: "center",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  warningHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  warningText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
