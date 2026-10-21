import "@copilotkit/react-core/v2/styles.css";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import type { ReactNode } from "react";
import { BASE_URL_API } from "@/customization/config-constants";
import { useCustomApiHeaders } from "@/customization/hooks/use-custom-api-headers";
import { getFetchCredentials } from "@/customization/utils/get-fetch-credentials";
import { useUtilityStore } from "@/stores/utilityStore";
import { useForwardedProps } from "./hooks/use-forwarded-props";

export const COPILOTKIT_RUNTIME_URL = `${BASE_URL_API}copilotkit`;
export const DEFAULT_COPILOT_AGENT_ID = "langflow";

/** True when the server offers the assistant chat (/api/v1/copilotkit). */
export function useCopilotChatEnabled(): boolean {
  const serverEnabled = useUtilityStore((state) => state.copilotkitChatEnabled);
  const agenticExperienceEnabled = useUtilityStore(
    (state) => state.agenticExperienceEnabled,
  );
  return serverEnabled && agenticExperienceEnabled;
}

/**
 * Connects the flow page to Langflow's CopilotKit runtime (/api/v1/copilotkit).
 *
 * Mounted once around the flow page so the chat panel and anything on the
 * canvas share one runtime connection. Renders its children unchanged when the
 * CopilotKit chat is off, so no runtime request is made then.
 *
 * Auth rides on the same-origin session cookie; ``credentials`` widens it to
 * cross-origin deployments exactly as the rest of the app's fetches do. The
 * Inspector is disabled: in development it adds a floating button and loads
 * from cdn.copilotkit.ai.
 */
export function CopilotProvider({
  children,
  properties,
}: {
  children: ReactNode;
  /** Sent to every agent run as ``RunAgentInput.forwardedProps``; defaults to {@link useForwardedProps}. */
  properties?: Record<string, unknown>;
}) {
  const enabled = useCopilotChatEnabled();
  const headers = useCustomApiHeaders();
  const forwardedProps = useForwardedProps();

  if (!enabled) return <>{children}</>;

  return (
    <CopilotKitProvider
      runtimeUrl={COPILOTKIT_RUNTIME_URL}
      agentId={DEFAULT_COPILOT_AGENT_ID}
      credentials={getFetchCredentials()}
      headers={headers}
      properties={properties ?? forwardedProps}
      enableInspector={false}
    >
      {children}
    </CopilotKitProvider>
  );
}
