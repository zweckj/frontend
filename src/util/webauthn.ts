// WebAuthn is only exposed in secure contexts, and the JSON helpers are only
// available in newer browsers.
export const isWebAuthnSupported = (): boolean =>
  typeof PublicKeyCredential !== "undefined" &&
  typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function" &&
  typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function";

const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;

// Mirrors the relying party rules of the backend: a ceremony needs an https
// origin and cannot use an IP address. This is stricter than isSecureContext,
// which also covers http://localhost.
export const isWebAuthnOriginSecure = (): boolean =>
  location.protocol === "https:" &&
  !IPV4_HOST.test(location.hostname) &&
  // Browsers report IPv6 hosts in brackets, so a colon means an IP literal.
  !location.hostname.includes(":");

export const isWebAuthnUsable = (): boolean =>
  isWebAuthnOriginSecure() && isWebAuthnSupported();

// Raised when the user dismissed the authenticator prompt or it timed out.
export const isWebAuthnAborted = (err: unknown): boolean =>
  err instanceof DOMException &&
  (err.name === "NotAllowedError" || err.name === "AbortError");

export const createWebAuthnCredential = async (
  options: PublicKeyCredentialCreationOptionsJSON
): Promise<RegistrationResponseJSON> => {
  const credential = (await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("The authenticator did not return a credential");
  }

  return credential.toJSON() as RegistrationResponseJSON;
};

export const getWebAuthnCredential = async (
  options: PublicKeyCredentialRequestOptionsJSON
): Promise<AuthenticationResponseJSON> => {
  const credential = (await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("The authenticator did not return a credential");
  }

  return credential.toJSON() as AuthenticationResponseJSON;
};
