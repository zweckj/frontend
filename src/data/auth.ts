import type { HaFormSchema } from "../components/ha-form/types";
import type { HomeAssistant } from "../types";
import type { RefreshTokenType } from "./refresh_token";

export interface AuthUrlSearchParams {
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  // Set when an external auth provider sent the browser back to us.
  auth_callback?: string;
  flow_id?: string;
}

export interface AuthProvider {
  name: string;
  id: string;
  type: string;
  users?: Record<string, string>;
}

/** Login flow that was parked while the browser visited an external provider. */
export interface ExternalLoginFlow {
  flow_id: string;
  client_id: string;
  redirect_uri: string;
  oauth2_state?: string;
  store_token: boolean;
  auth_provider: Pick<AuthProvider, "type" | "id">;
  // Set when the flow attaches credentials to a signed in user instead of
  // logging in, in which case the code goes back to this URL to be linked.
  link_user?: boolean;
  return_url?: string;
}

const EXTERNAL_LOGIN_FLOW_KEY = "externalLoginFlow";

export const storeExternalLoginFlow = (flow: ExternalLoginFlow) => {
  try {
    sessionStorage.setItem(EXTERNAL_LOGIN_FLOW_KEY, JSON.stringify(flow));
  } catch (_err: any) {
    // Ignore
  }
};

/** Return the parked flow, if any. It is cleared, as it can only be resumed once. */
export const takeExternalLoginFlow = (
  flowId: string
): ExternalLoginFlow | undefined => {
  try {
    const stored = sessionStorage.getItem(EXTERNAL_LOGIN_FLOW_KEY);
    sessionStorage.removeItem(EXTERNAL_LOGIN_FLOW_KEY);

    if (!stored) {
      return undefined;
    }

    const flow = JSON.parse(stored) as ExternalLoginFlow;
    return flow.flow_id === flowId ? flow : undefined;
  } catch (_err: any) {
    return undefined;
  }
};

export interface Credential {
  type: string;
}

export interface SignedPath {
  path: string;
}

export const hassUrl = __HASS_URL__;

export const autocompleteLoginFields = (schema: HaFormSchema[]) =>
  schema.map((field) => {
    if (field.type !== "string") return field;
    switch (field.name) {
      case "username":
        return { ...field, autocomplete: "username", autofocus: true };
      case "password":
        return { ...field, autocomplete: "current-password" };
      case "code":
        return { ...field, autocomplete: "one-time-code", autofocus: true };
      default:
        return field;
    }
  });

export const getSignedPath = (
  hass: Pick<HomeAssistant, "callWS">,
  path: string
): Promise<SignedPath> => hass.callWS({ type: "auth/sign_path", path });

/** Attach the credentials an authorization code stands for to the signed in user. */
export const linkUser = async (
  hass: HomeAssistant,
  clientId: string,
  code: string
) => {
  const response = await hass.fetchWithAuth("/auth/link_user", {
    method: "POST",
    body: JSON.stringify({ client_id: clientId, code }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new Error(body?.message || response.statusText);
  }
};

export const fetchAuthProviders = () =>
  fetch("/auth/providers", {
    credentials: "same-origin",
  });

export const createLoginFlow = (
  client_id: string | undefined,
  redirect_uri: string | undefined,
  handler: (string | null)[],
  type?: "authorize" | "link_user"
) =>
  fetch("/auth/login_flow", {
    method: "POST",
    credentials: "same-origin",
    body: JSON.stringify({
      client_id,
      handler,
      redirect_uri,
      type,
    }),
  });

export const submitLoginFlow = (flow_id: string, data: Record<string, any>) =>
  fetch(`/auth/login_flow/${flow_id}`, {
    method: "POST",
    credentials: "same-origin",
    body: JSON.stringify(data),
  });

export const deleteLoginFlow = (flow_id) =>
  fetch(`/auth/login_flow/${flow_id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });

export const redirectWithAuthCode = (
  url: string,
  authCode: string,
  oauth2State: string | undefined,
  storeToken: boolean
) => {
  // OAuth 2: 3.1.2 we need to retain query component of a redirect URI
  if (!url.includes("?")) {
    url += "?";
  } else if (!url.endsWith("?") && !url.endsWith("&")) {
    url += "&";
  }

  url += `code=${encodeURIComponent(authCode)}`;

  if (oauth2State) {
    url += `&state=${encodeURIComponent(oauth2State)}`;
  }
  if (storeToken) {
    url += `&storeToken=true`;
  }

  document.location.assign(url);
};

export const createAuthForUser = async (
  hass: HomeAssistant,
  userId: string,
  username: string,
  password: string
) =>
  hass.callWS({
    type: "config/auth_provider/homeassistant/create",
    user_id: userId,
    username,
    password,
  });

export const changePassword = (
  hass: HomeAssistant,
  current_password: string,
  new_password: string
) =>
  hass.callWS({
    type: "config/auth_provider/homeassistant/change_password",
    current_password,
    new_password,
  });

export const adminChangePassword = (
  hass: HomeAssistant,
  userId: string,
  password: string
) =>
  hass.callWS<undefined>({
    type: "config/auth_provider/homeassistant/admin_change_password",
    user_id: userId,
    password,
  });

export const adminChangeUsername = (
  hass: HomeAssistant,
  userId: string,
  username: string
) =>
  hass.callWS<undefined>({
    type: "config/auth_provider/homeassistant/admin_change_username",
    user_id: userId,
    username,
  });

export const deleteAllRefreshTokens = (
  hass: HomeAssistant,
  token_type?: RefreshTokenType,
  delete_current_token?: boolean
) =>
  hass.callWS({
    type: "auth/delete_all_refresh_tokens",
    token_type,
    delete_current_token,
  });
