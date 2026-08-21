import type { HomeAssistant } from "../types";

export const OIDC_PROVIDER_TYPE = "oidc";

export const OIDC_DEFAULT_REVALIDATE_INTERVAL = 86400;
export const OIDC_MIN_REVALIDATE_INTERVAL = 300;
export const OIDC_MAX_REVALIDATE_INTERVAL = 30 * 86400;

export interface OidcConfig {
  issuer: string;
  client_id: string;
  // The secret is write only, we only learn whether one is stored.
  client_secret_set: boolean;
  name: string | null;
  scopes: string[];
  username_claim: string;
  display_name_claim: string;
  admin_group: string | null;
  allow_auto_create: boolean;
  revalidate_interval: number;
}

export interface OidcConfigInfo {
  config: OidcConfig | null;
  redirect_uris: string[];
}

export interface OidcConfigUpdate {
  issuer: string;
  client_id: string;
  client_secret?: string | null;
  name?: string | null;
  scopes?: string[];
  username_claim?: string;
  display_name_claim?: string;
  admin_group?: string | null;
  allow_auto_create?: boolean;
  revalidate_interval?: number;
}

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string | null;
  jwks_uri: string;
  scopes_supported: string[];
  id_token_signing_alg_values_supported: string[];
}

export const fetchOidcConfig = (hass: HomeAssistant) =>
  hass.callWS<OidcConfigInfo>({ type: "config/auth_provider/oidc/get" });

export const updateOidcConfig = (
  hass: HomeAssistant,
  config: OidcConfigUpdate
) =>
  hass.callWS<{ config: OidcConfig }>({
    type: "config/auth_provider/oidc/update",
    ...config,
  });

export const deleteOidcConfig = (hass: HomeAssistant) =>
  hass.callWS({ type: "config/auth_provider/oidc/delete" });

/** Detach the signed in user's own identity provider login from their account. */
export const unlinkOidcAccount = (hass: HomeAssistant) =>
  hass.callWS({ type: "config/auth_provider/oidc/unlink" });

export const testOidcConfig = (
  hass: HomeAssistant,
  issuer: string,
  clientId: string
) =>
  hass.callWS<OidcDiscovery>({
    type: "config/auth_provider/oidc/test",
    issuer,
    client_id: clientId,
  });
