import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/auth/ha-auth-flow";
import {
  createLoginFlow,
  deleteLoginFlow,
  redirectWithAuthCode,
  submitLoginFlow,
} from "../../src/data/auth";
import { getWebAuthnCredential } from "../../src/util/webauthn";

vi.mock("../../src/components/ha-alert", () => ({}));
vi.mock("../../src/components/ha-button", () => ({}));
vi.mock("../../src/components/ha-checkbox", () => ({}));
vi.mock("../../src/auth/ha-auth-form", () => ({}));
vi.mock("../../src/data/auth", () => ({
  WEBAUTHN_AUTH_PROVIDER: "webauthn",
  autocompleteLoginFields: vi.fn(),
  createLoginFlow: vi.fn(),
  deleteLoginFlow: vi.fn(),
  redirectWithAuthCode: vi.fn(),
  submitLoginFlow: vi.fn(),
}));
vi.mock("../../src/util/webauthn", () => ({
  getWebAuthnCredential: vi.fn(),
  isWebAuthnAborted: () => false,
  isWebAuthnOriginSecure: () => true,
  isWebAuthnUsable: () => true,
}));

const requestOptions = {
  challenge: "challenge",
  rpId: "home.example",
  userVerification: "required",
} satisfies PublicKeyCredentialRequestOptionsJSON;
const assertion = {
  id: "passkey",
  rawId: "passkey",
  type: "public-key",
  response: {
    clientDataJSON: "client-data",
    authenticatorData: "authenticator-data",
    signature: "signature",
    userHandle: "dXNlcg",
  },
  clientExtensionResults: {},
} satisfies AuthenticationResponseJSON;
const form = {
  type: "form",
  flow_id: "login-flow",
  handler: ["webauthn", null],
  step_id: "init",
  data_schema: [
    { name: "authentication_credential", type: "string", required: true },
  ],
  errors: {},
  description_placeholders: {
    webauthn_options: JSON.stringify(requestOptions),
  },
};
const response = (data: unknown, ok = true) =>
  ({ ok, json: async () => data }) as Response;

describe("WebAuthn login flow", () => {
  let flow: HTMLElementTagNameMap["ha-auth-flow"];

  const mountFlow = async () => {
    flow = document.createElement("ha-auth-flow");
    flow.clientId = "https://home.example/";
    flow.redirectUri = "https://home.example/?auth_callback=1";
    flow.oauth2State = "client-state";
    flow.authProvider = { type: "webauthn", id: null, name: "Passkeys" };
    flow.localize = (key: string) => key;
    document.body.append(flow);
    await flow.updateComplete;
  };

  beforeEach(() => {
    vi.mocked(createLoginFlow).mockResolvedValue(response(form));
    vi.mocked(getWebAuthnCredential).mockResolvedValue(assertion);
    vi.mocked(deleteLoginFlow).mockResolvedValue(response({}));
    vi.mocked(submitLoginFlow).mockResolvedValue(
      response({ type: "create_entry", result: "auth-code" })
    );
  });

  afterEach(() => {
    flow.remove();
    vi.resetAllMocks();
  });

  it("preserves an initial abort without requesting an authenticator", async () => {
    const abort = {
      type: "abort",
      flow_id: "login-flow",
      handler: ["webauthn", null],
      reason: "invalid_origin",
    };
    vi.mocked(createLoginFlow).mockResolvedValue(response(abort));

    await mountFlow();

    await vi.waitFor(() => expect(flow.step).toEqual(abort));
    expect(getWebAuthnCredential).not.toHaveBeenCalled();
  });

  it("uses Core's relying-party options and submits the signed user handle unchanged", async () => {
    await mountFlow();

    await vi.waitFor(() => expect(redirectWithAuthCode).toHaveBeenCalledOnce());
    expect(getWebAuthnCredential).toHaveBeenCalledExactlyOnceWith(
      requestOptions
    );
    expect(submitLoginFlow).toHaveBeenCalledExactlyOnceWith("login-flow", {
      client_id: flow.clientId,
      authentication_credential: JSON.stringify(assertion),
    });
    expect(redirectWithAuthCode).toHaveBeenCalledWith(
      flow.redirectUri,
      "auth-code",
      "client-state",
      false
    );
  });

  it("preserves an abort returned after the credential was submitted", async () => {
    const abort = {
      type: "abort",
      flow_id: "login-flow",
      handler: ["webauthn", null],
      reason: "login_expired",
    };
    vi.mocked(submitLoginFlow).mockResolvedValue(response(abort));

    await mountFlow();

    await vi.waitFor(() => expect(flow.step).toEqual(abort));
    expect(redirectWithAuthCode).not.toHaveBeenCalled();
  });

  it("does not use an authorization code from a failed HTTP response", async () => {
    vi.mocked(submitLoginFlow).mockResolvedValue(
      response({ type: "create_entry", result: "rejected-code" }, false)
    );
    await mountFlow();

    await vi.waitFor(() => expect(submitLoginFlow).toHaveBeenCalledOnce());
    await flow.updateComplete;
    expect(redirectWithAuthCode).not.toHaveBeenCalled();
  });
});
