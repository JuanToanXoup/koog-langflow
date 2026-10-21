import { useEffect } from "react";
import { ModelSelector } from "@/components/core/copilotChat/components/model-selector";
import useCopilotChatStore from "@/stores/copilotChatStore";
import { useDefaultLanguageModel } from "../hooks/use-default-language-model";

/**
 * The panel's model picker. Starts from the user's default language model in
 * Settings when nothing was picked yet; the catalog's first entry is not
 * necessarily one the user's provider can serve.
 */
export function CopilotModelPicker() {
  const selectedModel = useCopilotChatStore((state) => state.selectedModel);
  const setSelectedModel = useCopilotChatStore(
    (state) => state.setSelectedModel,
  );
  const { data: defaultModel, isFetched } = useDefaultLanguageModel({
    enabled: selectedModel === null,
  });

  useEffect(() => {
    if (selectedModel || !defaultModel) return;
    setSelectedModel({
      id: `${defaultModel.provider}-${defaultModel.model_name}`,
      name: defaultModel.model_name,
      provider: defaultModel.provider,
      displayName: defaultModel.model_name,
    });
  }, [defaultModel, selectedModel, setSelectedModel]);

  // The selector picks a fallback model as soon as it has none; wait for the
  // Settings default so it never races ahead of it.
  if (selectedModel === null && !isFetched) return null;

  return (
    <ModelSelector
      selectedModel={selectedModel}
      onModelChange={setSelectedModel}
    />
  );
}
