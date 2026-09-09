import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  showAlertDialog,
  showConfirmationDialog,
  showPromptDialog,
} from "../../../src/dialogs/generic/show-dialog-box";
import "../../../src/panels/profile/ha-passkeys-card";
import type { HomeAssistant } from "../../../src/types";
import { createWebAuthnCredential } from "../../../src/util/webauthn";

vi.mock("../../../src/components/ha-alert", () => ({}));
vi.mock("../../../src/components/ha-button", () => ({}));
vi.mock("../../../src/components/ha-card", () => ({}));
vi.mock("../../../src/components/ha-icon-button", () => ({}));
vi.mock("../../../src/components/ha-settings-row", () => ({}));
vi.mock("../../../src/common/datetime/relative_time", () => ({
  relativeTime: () => "time",
}));
vi.mock("../../../src/dialogs/generic/show-dialog-box", () => ({
  showAlertDialog: vi.fn(),
  showConfirmationDialog: vi.fn(),
  showPromptDialog: vi.fn(),
}));
vi.mock("../../../src/util/webauthn", () => ({
  createWebAuthnCredential: vi.fn(),
  isWebAuthnAborted: () => false,
  isWebAuthnOriginSecure: () => true,
  isWebAuthnUsable: () => true,
}));

const credential = {
  credential_id: "existing-key",
  rp_id: "home.example",
  name: "Security key",
  created_at: 1,
  last_used_at: 2,
};
const options = {
  challenge: "challenge",
  rp: { id: "home.example", name: "Home Assistant" },
  user: { id: "dXNlcg", name: "User", displayName: "User" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
} satisfies PublicKeyCredentialCreationOptionsJSON;
const registration = {
  id: "new-key",
  rawId: "new-key",
  type: "public-key",
  response: {
    clientDataJSON: "client-data",
    attestationObject: "attestation",
    authenticatorData: "authenticator-data",
    publicKeyAlgorithm: -7,
    transports: ["internal"],
  },
  clientExtensionResults: {},
} satisfies RegistrationResponseJSON;

describe("passkey management", () => {
  let card: HTMLElementTagNameMap["ha-passkeys-card"];
  let callWS: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    callWS = vi.fn(async ({ type }: { type: string }) => {
      if (type === "config/auth_provider/webauthn/list") {
        return [credential];
      }
      if (type === "config/auth_provider/webauthn/register") {
        return options;
      }
      return undefined;
    });
    vi.mocked(showPromptDialog).mockResolvedValue("New key");
    vi.mocked(showConfirmationDialog).mockResolvedValue(true);
    vi.mocked(createWebAuthnCredential).mockResolvedValue(registration);
    card = document.createElement("ha-passkeys-card");
    card.hass = {
      callWS,
      localize: (key: string) => key,
    } as unknown as HomeAssistant;
    document.body.append(card);
    await vi.waitFor(() =>
      expect(card.shadowRoot?.querySelector("ha-icon-button")).not.toBeNull()
    );
    callWS.mockClear();
  });

  afterEach(() => {
    card.remove();
    vi.resetAllMocks();
  });

  it("does not start a registration when naming is canceled", async () => {
    vi.mocked(showPromptDialog).mockResolvedValue(null);

    card.shadowRoot!.querySelector<HTMLElement>("ha-button")!.click();
    await card.updateComplete;

    expect(showPromptDialog).toHaveBeenCalledOnce();
    expect(callWS).not.toHaveBeenCalled();
    expect(createWebAuthnCredential).not.toHaveBeenCalled();
  });

  it("registers once using Core's options and refreshes the current user", async () => {
    const refresh = vi.fn();
    card.addEventListener("hass-refresh-current-user", refresh);
    const button = card.shadowRoot!.querySelector<HTMLElement>("ha-button")!;
    button.click();
    button.click();

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(showPromptDialog).toHaveBeenCalledOnce();
    expect(createWebAuthnCredential).toHaveBeenCalledExactlyOnceWith(options);
    expect(callWS).toHaveBeenCalledWith({
      type: "config/auth_provider/webauthn/register_verify",
      credential: registration,
      name: "New key",
    });
  });

  it("refreshes account and session state after deleting a passkey", async () => {
    const refresh = vi.fn();
    const refreshTokens = vi.fn();
    card.addEventListener("hass-refresh-current-user", refresh);
    card.addEventListener("hass-refresh-tokens", refreshTokens);
    card.shadowRoot!.querySelectorAll<HTMLElement>("ha-icon-button")[1].click();

    await vi.waitFor(() => expect(refreshTokens).toHaveBeenCalledOnce());
    expect(refresh).toHaveBeenCalledOnce();
    expect(callWS).toHaveBeenCalledWith({
      type: "config/auth_provider/webauthn/delete",
      credential_id: credential.credential_id,
    });
  });

  it("retains credentials and reports Core's last-login-method refusal", async () => {
    const refresh = vi.fn();
    card.addEventListener("hass-refresh-current-user", refresh);
    callWS.mockRejectedValueOnce({
      code: "last_login_method",
      message: "Last login method",
    });
    card.shadowRoot!.querySelectorAll<HTMLElement>("ha-icon-button")[1].click();

    await vi.waitFor(() => expect(showAlertDialog).toHaveBeenCalledOnce());
    expect(showAlertDialog).toHaveBeenCalledWith(
      card,
      expect.objectContaining({
        text: "ui.panel.profile.passkeys.errors.last_login_method",
      })
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(callWS).toHaveBeenCalledTimes(1);
  });
});
