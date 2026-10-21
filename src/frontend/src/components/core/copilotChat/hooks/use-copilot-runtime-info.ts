import { api } from "@/controllers/API/api";
import { UseRequestProcessor } from "@/controllers/API/services/request-processor";
import { COPILOTKIT_RUNTIME_URL } from "../copilot-provider";

export interface CopilotAgentInfo {
  id: string;
  name: string;
  description: string;
}

interface RuntimeInfoResponse {
  agents?: Record<
    string,
    { name?: string; description?: string; className?: string }
  >;
}

/** The agents the runtime offers (``GET /api/v1/copilotkit/info``), for the agent picker. */
export function useCopilotRuntimeInfo({ enabled }: { enabled: boolean }) {
  const { query } = UseRequestProcessor();

  const getRuntimeInfo = async (): Promise<CopilotAgentInfo[]> => {
    const response = await api.get<RuntimeInfoResponse>(
      `${COPILOTKIT_RUNTIME_URL}/info`,
    );
    return Object.entries(response.data.agents ?? {}).map(([id, info]) => ({
      id,
      name: info.name || id,
      description: info.description ?? "",
    }));
  };

  return query(["useCopilotRuntimeInfo"], getRuntimeInfo, {
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
}
