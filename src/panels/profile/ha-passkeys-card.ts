import { mdiDelete, mdiPencil } from "@mdi/js";
import type { CSSResultGroup } from "lit";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import { relativeTime } from "../../common/datetime/relative_time";
import type { HASSDomCurrentTargetEvent } from "../../common/dom/fire_event";
import { fireEvent } from "../../common/dom/fire_event";
import "../../components/ha-alert";
import "../../components/ha-button";
import "../../components/ha-card";
import "../../components/ha-icon-button";
import type { HaIconButton } from "../../components/ha-icon-button";
import "../../components/ha-settings-row";
import type { WebAuthnCredentialMeta } from "../../data/auth_provider_webauthn";
import {
  deleteWebAuthnCredential,
  fetchWebAuthnCredentials,
  renameWebAuthnCredential,
  startWebAuthnRegistration,
  verifyWebAuthnRegistration,
} from "../../data/auth_provider_webauthn";
import {
  showAlertDialog,
  showConfirmationDialog,
  showPromptDialog,
} from "../../dialogs/generic/show-dialog-box";
import { haStyle } from "../../resources/styles";
import type { HomeAssistant } from "../../types";
import {
  createWebAuthnCredential,
  isWebAuthnAborted,
  isWebAuthnOriginSecure,
  isWebAuthnUsable,
} from "../../util/webauthn";

type CredentialButtonEvent = HASSDomCurrentTargetEvent<
  HaIconButton & { credential: WebAuthnCredentialMeta }
>;

@customElement("ha-passkeys-card")
class HaPasskeysCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _credentials?: WebAuthnCredentialMeta[];

  // Hide the card entirely only when the auth provider is disabled in YAML.
  @state() private _providerEnabled = true;

  @state() private _error?: string;

  @state() private _registering = false;

  protected firstUpdated() {
    this._fetchCredentials();
  }

  protected render() {
    if (!this._providerEnabled) {
      return nothing;
    }

    const secureOrigin = isWebAuthnOriginSecure();
    const canRegister = isWebAuthnUsable();

    return html`
      <ha-card
        .header=${this.hass.localize("ui.panel.profile.passkeys.header")}
      >
        <div class="card-content">
          ${this.hass.localize("ui.panel.profile.passkeys.description")}
          ${
            this._error
              ? html`<ha-alert alert-type="error">${this._error}</ha-alert>`
              : !secureOrigin
                ? html`<ha-alert alert-type="warning">
                    ${this.hass.localize(
                      "ui.panel.profile.passkeys.requires_https"
                    )}
                  </ha-alert>`
                : !canRegister
                  ? html`<ha-alert alert-type="info">
                      ${this.hass.localize(
                        "ui.panel.profile.passkeys.not_supported"
                      )}
                    </ha-alert>`
                  : nothing
          }
          ${
            this._credentials === undefined
              ? nothing
              : this._credentials.length
                ? this._credentials.map(
                    (credential) =>
                      html`<ha-settings-row three-line wrap-heading>
                        <span slot="heading">${credential.name}</span>
                        <div slot="description">
                          <div>
                            ${this.hass.localize(
                              "ui.panel.profile.passkeys.registered_for",
                              { domain: credential.rp_id }
                            )}
                          </div>
                          ${this.hass.localize(
                            "ui.panel.profile.passkeys.created_last_used",
                            {
                              created: relativeTime(
                                new Date(credential.created_at * 1000),
                                this.hass.locale
                              ),
                              last_used: relativeTime(
                                new Date(credential.last_used_at * 1000),
                                this.hass.locale
                              ),
                            }
                          )}
                        </div>
                        <ha-icon-button
                          .credential=${credential}
                          .label=${this.hass.localize("ui.common.rename")}
                          .path=${mdiPencil}
                          .disabled=${this._registering}
                          @click=${this._renameCredential}
                        ></ha-icon-button>
                        <ha-icon-button
                          .credential=${credential}
                          .label=${this.hass.localize("ui.common.delete")}
                          .path=${mdiDelete}
                          .disabled=${this._registering}
                          @click=${this._deleteCredential}
                        ></ha-icon-button>
                      </ha-settings-row>`
                  )
                : html`<p>
                    ${this.hass.localize(
                      "ui.panel.profile.passkeys.empty_state"
                    )}
                  </p>`
          }
        </div>
        <div class="card-actions">
          <ha-button
            .disabled=${!canRegister || this._registering}
            .loading=${this._registering}
            @click=${this._addCredential}
          >
            ${this.hass.localize("ui.panel.profile.passkeys.add")}
          </ha-button>
        </div>
      </ha-card>
    `;
  }

  private async _fetchCredentials(): Promise<void> {
    try {
      this._credentials = await fetchWebAuthnCredentials(this.hass);
      this._error = undefined;
    } catch (err: any) {
      if (err.code === "not_enabled") {
        this._providerEnabled = false;
        return;
      }
      this._error = this.hass.localize("ui.panel.profile.passkeys.load_failed");
    }
  }

  private async _addCredential(): Promise<void> {
    if (this._registering) {
      return;
    }
    this._registering = true;
    this._error = undefined;
    try {
      const name = await showPromptDialog(this, {
        title: this.hass.localize("ui.panel.profile.passkeys.name_title"),
        inputLabel: this.hass.localize("ui.panel.profile.passkeys.name"),
        confirmText: this.hass.localize("ui.common.save"),
      });
      if (name === null) {
        return;
      }
      const options = await startWebAuthnRegistration(this.hass);
      const credential = await createWebAuthnCredential(options);
      await verifyWebAuthnRegistration(
        this.hass,
        credential,
        name || undefined
      );
      fireEvent(this, "hass-refresh-current-user");
    } catch (err: any) {
      if (isWebAuthnAborted(err)) {
        return;
      }
      if (err.code === "invalid_origin") {
        this._error = this.hass.localize(
          "ui.panel.profile.passkeys.invalid_origin"
        );
        return;
      }
      await showAlertDialog(this, {
        title: this.hass.localize("ui.panel.profile.passkeys.add_failed"),
        text: this._errorMessage(err),
      });
      return;
    } finally {
      this._registering = false;
    }
    await this._fetchCredentials();
  }

  private async _renameCredential(ev: CredentialButtonEvent): Promise<void> {
    const credential = ev.currentTarget.credential;

    const name = await showPromptDialog(this, {
      title: this.hass.localize("ui.panel.profile.passkeys.rename_title"),
      inputLabel: this.hass.localize("ui.panel.profile.passkeys.name"),
      defaultValue: credential.name,
      confirmText: this.hass.localize("ui.common.rename"),
    });

    if (!name || name === credential.name) {
      return;
    }

    try {
      await renameWebAuthnCredential(this.hass, credential.credential_id, name);
    } catch (err: any) {
      await showAlertDialog(this, {
        title: this.hass.localize("ui.panel.profile.passkeys.rename_failed"),
        text: this._errorMessage(err),
      });
      return;
    }
    await this._fetchCredentials();
  }

  private async _deleteCredential(ev: CredentialButtonEvent): Promise<void> {
    const credential = ev.currentTarget.credential;

    if (
      !(await showConfirmationDialog(this, {
        title: this.hass.localize(
          "ui.panel.profile.passkeys.confirm_delete_title"
        ),
        text: this.hass.localize(
          "ui.panel.profile.passkeys.confirm_delete_text",
          { name: credential.name }
        ),
        confirmText: this.hass.localize("ui.common.delete"),
        destructive: true,
      }))
    ) {
      return;
    }

    try {
      await deleteWebAuthnCredential(this.hass, credential.credential_id);
      fireEvent(this, "hass-refresh-current-user");
      fireEvent(this, "hass-refresh-tokens");
    } catch (err: any) {
      await showAlertDialog(this, {
        title: this.hass.localize("ui.panel.profile.passkeys.delete_failed"),
        text: this._errorMessage(err),
      });
      return;
    }
    await this._fetchCredentials();
  }

  private _errorMessage(err: { code?: string; message: string }) {
    switch (err.code) {
      case "credential_already_registered":
      case "credential_not_found":
      case "last_login_method":
      case "invalid_auth":
        return this.hass.localize(
          `ui.panel.profile.passkeys.errors.${err.code}`
        );
      default:
        return err.message;
    }
  }

  static get styles(): CSSResultGroup {
    return [
      haStyle,
      css`
        ha-settings-row {
          padding: 0;
        }
        ha-icon-button {
          color: var(--primary-text-color);
        }
        .card-actions {
          display: flex;
          justify-content: flex-end;
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-passkeys-card": HaPasskeysCard;
  }
}
