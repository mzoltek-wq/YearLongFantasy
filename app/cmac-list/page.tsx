import { MagicDraftAssistant } from "@/components/magic-assistant/magic-draft-assistant";

export const dynamic = "force-dynamic";

export default function CmacListPage() {
  return (
    <MagicDraftAssistant
      description="Separate hidden board backed by the same live league data, with its own watch, DND, and crossed-off lists."
      eyebrow="Cmac list"
      storageKeyPrefix="cmac-magic-assistant"
      title="Best available, minus reality"
    />
  );
}
