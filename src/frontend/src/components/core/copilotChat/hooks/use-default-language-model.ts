import { api } from "@/controllers/API/api";
import { getURL } from "@/controllers/API/helpers/constants";
import { UseRequestProcessor } from "@/controllers/API/services/request-processor";

interface DefaultModelResponse {
  default_model: {
    model_name: string;
    provider: string;
    model_type: string;
  } | null;
}

/** The user's default language model from Settings (``GET /models/default_model``). */
export function useDefaultLanguageModel({ enabled }: { enabled: boolean }) {
  const { query } = UseRequestProcessor();

  const getDefaultModel = async () => {
    const response = await api.get<DefaultModelResponse>(
      `${getURL("MODELS")}/default_model?model_type=language`,
    );
    return response.data.default_model;
  };

  return query(["useDefaultLanguageModel"], getDefaultModel, {
    enabled,
    refetchOnWindowFocus: false,
  });
}
