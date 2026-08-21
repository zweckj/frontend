import { mdiContentCopy } from "@mdi/js";
import type { PropertyValues } from "lit";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import memoizeOne from "memoize-one";
import type { LocalizeFunc } from "../../../common/translations/localize";
import { copyToClipboard } from "../../../common/util/copy-clipboard";
import "../../../components/ha-alert";
import "../../../components/ha-button";
import "../../../components/ha-card";
import "../../../components/ha-form/ha-form";
import type { SchemaUnion } from "../../../components/ha-form/types";
import "../../../components/ha-icon-button";
import "../../../components/ha-settings-row";
import type { OidcConfigUpdate } from "../../../data/auth_provider_oidc";
import {
  deleteOidcConfig,
  fetchOidcConfig,
  OIDC_DEFAULT_REVALIDATE_INTERVAL,
  OIDC_MAX_REVALIDATE_INTERVAL,
  OIDC_MIN_REVALIDATE_INTERVAL,
  testOidcConfig,
  updateOidcConfig,
} from "../../../data/auth_provider_oidc";
import { showConfirmationDialog } from "../../../dialogs/generic/show-dialog-box";
import "../../../layouts/hass-tabs-subpage";
import { haStyle } from "../../../resources/styles";
import type { HomeAssistant, Route } from "../../../types";
import { showToast } from "../../../util/toast";
import { configSections } from "../config-sections";

const SECONDS_PER_MINUTE = 60;

interface OidcFormData {
  issuer: string;
  client_id: string;
  use_client_secret: boolean;
  client_secret: string;
  name: string;
  scopes: string[];
  username_claim: string;
  display_name_claim: string;
  admin_group: string;
  allow_auto_create: boolean;
  revalidate_interval: number;
}

const DEFAULT_FORM_DATA: OidcFormData = {
  issuer: "",
  client_id: "",
  use_client_secret: true,
  client_secret: "",
  name: "",
  scopes: ["openid", "profile", "email"],
  username_claim: "preferred_username",
  display_name_claim: "name",
  admin_group: "home_assistant_admin",
  allow_auto_create: false,
  revalidate_interval: OIDC_DEFAULT_REVALIDATE_INTERVAL / SECONDS_PER_MINUTE,
};

const SCHEMA = memoizeOne(
  (localize: LocalizeFunc) =>
    [
      { name: "issuer", required: true, selector: { text: { type: "url" } } },
      { name: "client_id", required: true, selector: { text: {} } },
      { name: "use_client_secret", selector: { boolean: {} } },
      {
        name: "client_secret",
        visible: { field: "use_client_secret", value: true },
        selector: { text: { type: "password" } },
      },
      {
        name: "accounts",
        type: "expandable",
        flatten: true,
        title: localize("ui.panel.config.single_sign_on.sections.accounts"),
        schema: [
          { name: "allow_auto_create", selector: { boolean: {} } },
          { name: "admin_group", selector: { text: {} } },
          { name: "username_claim", required: true, selector: { text: {} } },
          {
            name: "display_name_claim",
            required: true,
            selector: { text: {} },
          },
        ],
      },
      {
        name: "advanced",
        type: "expandable",
        flatten: true,
        title: localize("ui.panel.config.single_sign_on.sections.advanced"),
        schema: [
          { name: "name", selector: { text: {} } },
          {
            name: "scopes",
            required: true,
            selector: {
              select: {
                multiple: true,
                custom_value: true,
                options: ["openid", "profile", "email", "groups"],
              },
            },
          },
          {
            name: "revalidate_interval",
            required: true,
            selector: {
              number: {
                min: OIDC_MIN_REVALIDATE_INTERVAL / SECONDS_PER_MINUTE,
                max: OIDC_MAX_REVALIDATE_INTERVAL / SECONDS_PER_MINUTE,
                mode: "box",
                unit_of_measurement: localize(
                  "ui.panel.config.single_sign_on.minutes"
                ),
              },
            },
          },
        ],
      },
    ] as const
);

@customElement("ha-config-single-sign-on")
class HaConfigSingleSignOn extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ attribute: false }) public route!: Route;

  @state() private _data?: OidcFormData;

  @state() private _configured = false;

  @state() private _secretStored = false;

  @state() private _redirectUris: string[] = [];

  @state() private _error?: string;

  @state() private _testResult?: string;

  @state() private _notEnabled = false;

  @state() private _saving = false;

  @state() private _testing = false;

  protected firstUpdated(changedProps: PropertyValues<this>) {
    super.firstUpdated(changedProps);
    this._load();
  }

  protected render() {
    return html`
      <hass-tabs-subpage
        .hass=${this.hass}
        .route=${this.route}
        back-path="/config"
        .tabs=${configSections.persons}
      >
        <div class="content">
          ${
            this._notEnabled
              ? html`<ha-alert alert-type="warning">
                  ${this.hass.localize(
                    "ui.panel.config.single_sign_on.not_enabled"
                  )}
                </ha-alert>`
              : this._data
                ? html`${this._renderRedirectUris()}${this._renderForm()}`
                : nothing
          }
        </div>
      </hass-tabs-subpage>
    `;
  }

  private _renderRedirectUris() {
    if (!this._redirectUris.length) {
      return nothing;
    }

    return html`
      <ha-card
        outlined
        .header=${this.hass.localize(
          "ui.panel.config.single_sign_on.redirect_uris.header"
        )}
      >
        <div class="card-content">
          <p class="description">
            ${this.hass.localize(
              "ui.panel.config.single_sign_on.redirect_uris.description"
            )}
          </p>
          ${this._redirectUris.map(
            (uri) => html`
              <ha-settings-row wrap-heading>
                <span slot="heading" class="uri">${uri}</span>
                <ha-icon-button
                  .path=${mdiContentCopy}
                  data-uri=${uri}
                  .label=${this.hass.localize("ui.common.copy")}
                  @click=${this._copyUri}
                ></ha-icon-button>
              </ha-settings-row>
            `
          )}
        </div>
      </ha-card>
    `;
  }

  private _renderForm() {
    return html`
      <ha-card
        outlined
        .header=${this.hass.localize(
          "ui.panel.config.single_sign_on.provider.header"
        )}
      >
        <div class="card-content">
          <p class="description">
            ${this.hass.localize(
              "ui.panel.config.single_sign_on.provider.description"
            )}
          </p>
          ${
            this._error
              ? html`<ha-alert alert-type="error">${this._error}</ha-alert>`
              : nothing
          }
          ${
            this._testResult
              ? html`<ha-alert alert-type="success"
                  >${this._testResult}</ha-alert
                >`
              : nothing
          }
          <ha-form
            .hass=${this.hass}
            .data=${this._data!}
            .schema=${SCHEMA(this.hass.localize)}
            .disabled=${this._saving}
            .computeLabel=${this._computeLabel}
            .computeHelper=${this._computeHelper}
            @value-changed=${this._valueChanged}
          ></ha-form>
        </div>
        <div class="card-actions">
          <ha-button
            @click=${this._save}
            .disabled=${this._saving || this._testing}
            .loading=${this._saving}
          >
            ${this.hass.localize("ui.common.save")}
          </ha-button>
          <ha-button
            appearance="plain"
            @click=${this._test}
            .disabled=${this._saving || this._testing}
            .loading=${this._testing}
          >
            ${this.hass.localize("ui.panel.config.single_sign_on.test")}
          </ha-button>
          ${
            this._configured
              ? html`
                  <ha-button
                    class="delete"
                    appearance="plain"
                    variant="danger"
                    @click=${this._delete}
                    .disabled=${this._saving || this._testing}
                  >
                    ${this.hass.localize("ui.common.remove")}
                  </ha-button>
                `
              : nothing
          }
        </div>
      </ha-card>
    `;
  }

  private _computeLabel = (
    schema: SchemaUnion<ReturnType<typeof SCHEMA>>
  ): string => {
    if ("type" in schema && schema.type === "expandable") {
      return "";
    }
    return this.hass.localize(
      `ui.panel.config.single_sign_on.fields.${schema.name}` as any
    );
  };

  private _computeHelper = (
    schema: SchemaUnion<ReturnType<typeof SCHEMA>>
  ): string => {
    if ("type" in schema && schema.type === "expandable") {
      return "";
    }
    if (schema.name === "client_secret" && this._secretStored) {
      return this.hass.localize(
        "ui.panel.config.single_sign_on.helpers.client_secret_stored"
      );
    }
    return (
      this.hass.localize(
        `ui.panel.config.single_sign_on.helpers.${schema.name}` as any
      ) || ""
    );
  };

  private async _load() {
    try {
      const { config, redirect_uris } = await fetchOidcConfig(this.hass);
      this._redirectUris = redirect_uris;
      this._configured = !!config;
      this._secretStored = !!config?.client_secret_set;
      this._data = config
        ? {
            issuer: config.issuer,
            client_id: config.client_id,
            use_client_secret: config.client_secret_set,
            client_secret: "",
            name: config.name ?? "",
            scopes: config.scopes,
            username_claim: config.username_claim,
            display_name_claim: config.display_name_claim,
            admin_group: config.admin_group ?? "",
            allow_auto_create: config.allow_auto_create,
            revalidate_interval:
              config.revalidate_interval / SECONDS_PER_MINUTE,
          }
        : { ...DEFAULT_FORM_DATA };
    } catch (err: any) {
      if (err.code === "not_enabled") {
        this._notEnabled = true;
        return;
      }
      this._error = err.message;
      this._data = { ...DEFAULT_FORM_DATA };
    }
  }

  private _valueChanged(ev: CustomEvent) {
    this._data = ev.detail.value;
    this._error = undefined;
    this._testResult = undefined;
  }

  private _buildUpdate(data: OidcFormData): OidcConfigUpdate {
    const update: OidcConfigUpdate = {
      issuer: data.issuer.trim(),
      client_id: data.client_id.trim(),
      name: data.name.trim() || null,
      scopes: data.scopes,
      username_claim: data.username_claim,
      display_name_claim: data.display_name_claim,
      admin_group: data.admin_group.trim() || null,
      allow_auto_create: data.allow_auto_create,
      revalidate_interval: data.revalidate_interval * SECONDS_PER_MINUTE,
    };

    // Omitting the secret keeps the stored one, so only send it when it changes.
    if (!data.use_client_secret) {
      update.client_secret = null;
    } else if (data.client_secret) {
      update.client_secret = data.client_secret;
    }

    return update;
  }

  private async _save() {
    if (!this._data) {
      return;
    }

    if (
      this._configured &&
      !(await showConfirmationDialog(this, {
        title: this.hass.localize(
          "ui.panel.config.single_sign_on.confirm_save.title"
        ),
        text: this.hass.localize(
          "ui.panel.config.single_sign_on.confirm_save.text"
        ),
        confirmText: this.hass.localize("ui.common.save"),
        dismissText: this.hass.localize("ui.common.cancel"),
        destructive: true,
      }))
    ) {
      return;
    }

    this._saving = true;
    this._error = undefined;
    this._testResult = undefined;

    try {
      const { config } = await updateOidcConfig(
        this.hass,
        this._buildUpdate(this._data)
      );
      this._configured = true;
      this._secretStored = config.client_secret_set;
      this._data = { ...this._data, client_secret: "" };
      showToast(this, {
        message: this.hass.localize("ui.panel.config.single_sign_on.saved"),
      });
    } catch (err: any) {
      this._error = err.message;
    } finally {
      this._saving = false;
    }
  }

  private async _test() {
    if (!this._data) {
      return;
    }

    this._testing = true;
    this._error = undefined;
    this._testResult = undefined;

    try {
      const discovery = await testOidcConfig(
        this.hass,
        this._data.issuer.trim(),
        this._data.client_id.trim()
      );
      this._testResult = this.hass.localize(
        "ui.panel.config.single_sign_on.test_success",
        { issuer: discovery.issuer }
      );
    } catch (err: any) {
      this._error = err.message;
    } finally {
      this._testing = false;
    }
  }

  private async _delete() {
    if (
      !(await showConfirmationDialog(this, {
        title: this.hass.localize(
          "ui.panel.config.single_sign_on.confirm_delete.title"
        ),
        text: this.hass.localize(
          "ui.panel.config.single_sign_on.confirm_delete.text"
        ),
        confirmText: this.hass.localize("ui.common.remove"),
        dismissText: this.hass.localize("ui.common.cancel"),
        destructive: true,
      }))
    ) {
      return;
    }

    this._saving = true;
    this._error = undefined;
    this._testResult = undefined;

    try {
      await deleteOidcConfig(this.hass);
      this._configured = false;
      this._secretStored = false;
      this._data = { ...DEFAULT_FORM_DATA };
    } catch (err: any) {
      this._error = err.message;
    } finally {
      this._saving = false;
    }
  }

  private async _copyUri(ev: Event) {
    await copyToClipboard((ev.currentTarget as HTMLElement).dataset.uri);
    showToast(this, {
      message: this.hass.localize("ui.common.copied_clipboard"),
    });
  }

  static styles = [
    haStyle,
    css`
      .content {
        padding: 28px 20px 0;
        max-width: 1040px;
        margin: 0 auto;
      }
      ha-card {
        margin-bottom: max(24px, var(--safe-area-inset-bottom));
      }
      .description {
        margin-top: 0;
        color: var(--secondary-text-color);
      }
      .uri {
        word-break: break-all;
      }
      .card-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .card-actions .delete {
        margin-inline-start: auto;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-config-single-sign-on": HaConfigSingleSignOn;
  }
}
