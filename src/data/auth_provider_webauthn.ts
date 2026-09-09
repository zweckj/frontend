import type { HomeAssistant } from "../types";

export interface WebAuthnCredentialMeta {
  credential_id: string;
  rp_id: string;
  name: string;
  /** Seconds since the epoch. */
  created_at: number;
  /** Seconds since the epoch. */
  last_used_at: number;
}

export const fetchWebAuthnCredentials = (hass: HomeAssistant) =>
  hass.callWS<WebAuthnCredentialMeta[]>({
    type: "config/auth_provider/webauthn/list",
  });

export const startWebAuthnRegistration = (hass: HomeAssistant) =>
  hass.callWS<PublicKeyCredentialCreationOptionsJSON>({
    type: "config/auth_provider/webauthn/register",
  });

export const verifyWebAuthnRegistration = (
  hass: HomeAssistant,
  credential: RegistrationResponseJSON,
  name?: string
) =>
  hass.callWS<undefined>({
    type: "config/auth_provider/webauthn/register_verify",
    credential,
    name,
  });

export const deleteWebAuthnCredential = (
  hass: HomeAssistant,
  credentialId: string
) =>
  hass.callWS<undefined>({
    type: "config/auth_provider/webauthn/delete",
    credential_id: credentialId,
  });

export const renameWebAuthnCredential = (
  hass: HomeAssistant,
  credentialId: string,
  name: string
) =>
  hass.callWS<undefined>({
    type: "config/auth_provider/webauthn/rename",
    credential_id: credentialId,
    name,
  });
