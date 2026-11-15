import { useId } from "react";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";

export function useModelPickerShortcut({
  open,
  disabled,
  isOpen,
}: {
  open: () => void;
  disabled: boolean;
  isOpen: boolean;
}) {
  const handlerId = useId();
  const { isActiveComposer } = useComposerKeyboardScope();
  useKeyboardActionHandler({
    handlerId,
    actions: ["message-input.model-picker"],
    enabled: isActiveComposer && !disabled && !isOpen,
    priority: 200,
    handle: (action) => {
      if (action.id !== "message-input.model-picker") return false;
      open();
      return true;
    },
  });
}
