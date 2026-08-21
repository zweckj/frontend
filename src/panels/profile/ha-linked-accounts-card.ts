import { genClientId } from "home-assistant-js-websocket";
import type { PropertyValues } from "lit";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import { fireEvent } from "../../common/dom/fire_event";
import { replaceCurrentUrl } from "../../common/navigate";
import { sanitizeHttpUrl } from "../../common/url/sanitize-http-url";
import "../../components/ha-button";
import "../../components/ha-card";
import "../../components/ha-settings-row";
import type { AuthProvider } from "../../data/auth";
import {
  createLoginFlow,
  deleteLoginFlow,
  fetchAuthProviders,
  linkUser,
  storeExternalLoginFlow,
} from "../../data/auth";
import {
  OIDC_PROVIDER_TYPE,
  unlinkOidcAccount,
} from "../../data/auth_provider_oidc";
import {
  showAlertDialog,
  showConfirmationDialog,
} from "../../dialogs/generic/show-dialog-box";
import type { HomeAssistant } from "../../types";

const RETURN_PATH = "/profile/security";
const CODE_PARAM = "link_user_code";

const providerKey = (provider: AuthProvider) =>
  `${provider.type}:${provider.id}`;

@customElement("ha-linked-accounts-card")
class HaLinkedAccountsCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _authProviders?: AuthProvider[];

  @state() private _busy?: string;

  protected firstUpdated(changedProps: PropertyValues<this>) {
    super.firstUpdated(changedProps);
    this._fetchAuthProviders();
    this._finishLinking();
  }

  protected render() {
    if (!this._authProviders) {
      return nothing;
    }

    const linked = this._authProviders.filter((provider) =>
      this._isLinked(provider)
    );
    const linkable = this._authProviders.filter(
      // A username and password is managed by the password card instead.
      (provider) =>
        provider.type !== "homeassistant" && !this._isLinked(provider)
    );

    if (!linked.length && !linkable.length) {
      return nothing;
    }

    return html`
      <ha-card
        .header=${this.hass.localize("ui.panel.profile.linked_accounts.header")}
      >
        <div class="card-content">
          ${this.hass.localize("ui.panel.profile.linked_accounts.description")}
        </div>
        ${linked.map(
          (provider) => html`
            <ha-settings-row>
              <span slot="heading">${provider.name}</span>
              <span slot="description">
                ${this.hass.localize("ui.panel.profile.linked_accounts.linked")}
              </span>
              ${
                provider.type === OIDC_PROVIDER_TYPE
                  ? html`
                      <ha-button
                        size="s"
                        appearance="plain"
                        variant="danger"
                        .disabled=${!!this._busy}
                        .loading=${this._busy === providerKey(provider)}
                        data-provider=${providerKey(provider)}
                        @click=${this._unlink}
                      >
                        ${this.hass.localize(
                          "ui.panel.profile.linked_accounts.unlink"
                        )}
                      </ha-button>
                    `
                  : nothing
              }
            </ha-settings-row>
          `
        )}
        ${linkable.map(
          (provider) => html`
            <ha-settings-row>
              <span slot="heading">${provider.name}</span>
              <ha-button
                size="s"
                appearance="plain"
                .disabled=${!!this._busy}
                .loading=${this._busy === providerKey(provider)}
                data-provider=${providerKey(provider)}
                @click=${this._link}
              >
                ${this.hass.localize("ui.panel.profile.linked_accounts.link")}
              </ha-button>
            </ha-settings-row>
          `
        )}
      </ha-card>
    `;
  }

  private _isLinked(provider: AuthProvider) {
    return this.hass.user!.credentials.some(
      (credential) =>
        credential.auth_provider_type === provider.type &&
        credential.auth_provider_id === provider.id
    );
  }

  private async _fetchAuthProviders() {
    try {
      const response = await fetchAuthProviders();
      const { providers } = await response.json();
      this._authProviders = providers;
    } catch (_err: any) {
      this._authProviders = [];
    }
  }

  private async _link(ev: Event) {
    const key = (ev.currentTarget as HTMLElement).dataset.provider;
    const provider = this._authProviders?.find(
      (candidate) => providerKey(candidate) === key
    );

    if (!provider) {
      return;
    }

    const clientId = genClientId();
    this._busy = key;

    try {
      const response = await createLoginFlow(
        clientId,
        clientId,
        [provider.type, provider.id],
        "link_user"
      );
      const step = await response.json();

      if (!response.ok) {
        throw new Error(step.message);
      }

      const url = step.type === "external" && sanitizeHttpUrl(step.url);

      if (!url) {
        deleteLoginFlow(step.flow_id);
        throw new Error(
          this.hass.localize("ui.panel.profile.linked_accounts.not_supported")
        );
      }

      storeExternalLoginFlow({
        flow_id: step.flow_id,
        client_id: clientId,
        redirect_uri: clientId,
        store_token: false,
        auth_provider: { type: provider.type, id: provider.id },
        link_user: true,
        return_url: RETURN_PATH,
      });

      document.location.assign(url);
    } catch (err: any) {
      this._busy = undefined;
      this._showError(err);
    }
  }

  private async _unlink(ev: Event) {
    if (
      !(await showConfirmationDialog(this, {
        title: this.hass.localize(
          "ui.panel.profile.linked_accounts.confirm_unlink.title"
        ),
        text: this.hass.localize(
          "ui.panel.profile.linked_accounts.confirm_unlink.text"
        ),
        confirmText: this.hass.localize(
          "ui.panel.profile.linked_accounts.unlink"
        ),
        dismissText: this.hass.localize("ui.common.cancel"),
        destructive: true,
      }))
    ) {
      return;
    }

    this._busy = (ev.currentTarget as HTMLElement).dataset.provider;

    try {
      await unlinkOidcAccount(this.hass);
      fireEvent(this, "hass-refresh-current-user");
    } catch (err: any) {
      this._showError(err);
    } finally {
      this._busy = undefined;
    }
  }

  private async _finishLinking() {
    const params = new URLSearchParams(location.search);
    const code = params.get(CODE_PARAM);

    if (!code) {
      return;
    }

    params.delete(CODE_PARAM);
    const query = params.toString();
    replaceCurrentUrl(`${location.pathname}${query ? `?${query}` : ""}`);

    try {
      await linkUser(this.hass, genClientId(), code);
      fireEvent(this, "hass-refresh-current-user");
    } catch (err: any) {
      this._showError(err);
    }
  }

  private _showError(err: { code?: string; message: string }) {
    showAlertDialog(this, {
      title: this.hass.localize("ui.panel.profile.linked_accounts.header"),
      text:
        (err.code &&
          this.hass.localize(
            `ui.panel.profile.linked_accounts.errors.${err.code}` as any
          )) ||
        err.message,
    });
  }

  static styles = css`
    ha-button {
      margin-right: -0.57em;
      margin-inline-end: -0.57em;
      margin-inline-start: initial;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-linked-accounts-card": HaLinkedAccountsCard;
  }
}
