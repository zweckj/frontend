/* eslint-disable lit/prefer-static-styles */
import { genClientId } from "home-assistant-js-websocket";
import type { PropertyValues } from "lit";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators";
import { keyed } from "lit/directives/keyed";
import type { LocalizeFunc } from "../common/translations/localize";
import { sanitizeHttpUrl } from "../common/url/sanitize-http-url";
import "../components/ha-alert";
import "../components/ha-button";
import "../components/ha-checkbox";
import { computeInitialHaFormData } from "../components/ha-form/compute-initial-ha-form-data";
import type { AuthProvider, ExternalLoginFlow } from "../data/auth";
import {
  autocompleteLoginFields,
  createLoginFlow,
  deleteLoginFlow,
  redirectWithAuthCode,
  storeExternalLoginFlow,
  submitLoginFlow,
} from "../data/auth";
import type {
  DataEntryFlowStep,
  DataEntryFlowStepExternal,
  DataEntryFlowStepForm,
} from "../data/data_entry_flow";
import "./ha-auth-form";
import type { HaAuthForm } from "./ha-auth-form";

type State = "loading" | "error" | "step";

@customElement("ha-auth-flow")
export class HaAuthFlow extends LitElement {
  @property({ attribute: false }) public authProvider?: AuthProvider;

  @property({ attribute: false }) public clientId?: string;

  @property({ attribute: false }) public redirectUri?: string;

  @property({ attribute: false }) public oauth2State?: string;

  @property({ attribute: false }) public localize!: LocalizeFunc;

  @property({ attribute: false }) public step?: DataEntryFlowStep;

  @property({ attribute: false }) public initStoreToken = false;

  @property({ attribute: false }) public externalLoginFlow?: ExternalLoginFlow;

  @state() private _storeToken = false;

  @state() private _state: State = "loading";

  @state() private _stepData?: Record<string, any>;

  @state() private _errorMessage?: string;

  @state() private _submitting = false;

  @query("ha-auth-form") private _form?: HaAuthForm;

  @query("ha-form") private _haForm?: HTMLElement;

  private _externalLoginFlowResumed = false;

  private _linkUserReturnUrl?: string;

  createRenderRoot() {
    return this;
  }

  willUpdate(changedProps: PropertyValues<this>) {
    super.willUpdate(changedProps);

    if (!this.hasUpdated && this.clientId === genClientId()) {
      // Preselect store token when logging in to own instance
      this._storeToken = this.initStoreToken;
    }

    if (!changedProps.has("step")) {
      return;
    }

    if (!this.step) {
      this._stepData = undefined;
      return;
    }

    this._state = "step";

    const oldStep = changedProps.get("step") as HaAuthFlow["step"];

    if (
      !oldStep ||
      this.step.flow_id !== oldStep.flow_id ||
      (this.step.type === "form" &&
        oldStep.type === "form" &&
        this.step.step_id !== oldStep.step_id)
    ) {
      this._stepData =
        this.step.type === "form"
          ? computeInitialHaFormData(this.step.data_schema)
          : undefined;
    }
  }

  protected render() {
    return html`
      <style>
        a.forgot-password {
          color: var(--primary-color);
          text-decoration: none;
          font-size: 0.875rem;
        }
        .space-between {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        form {
          text-align: center;
          max-width: 336px;
          width: 100%;
        }
        ha-auth-form {
          display: block;
          margin-top: 16px;
        }
        .action {
          margin-top: var(--ha-space-5);
        }
        .action ha-button {
          width: 100%;
        }
      </style>
      <form>${this._renderForm()}</form>
    `;
  }

  protected firstUpdated(changedProps: PropertyValues<this>) {
    super.firstUpdated(changedProps);

    if (this.clientId == null || this.redirectUri == null) {
      // eslint-disable-next-line no-console
      console.error(
        "clientId and redirectUri must not be null",
        this.clientId,
        this.redirectUri
      );
      this._state = "error";
      this._errorMessage = this._unknownError();
      return;
    }

    this.addEventListener("keypress", (ev) => {
      if (ev.key === "Enter") {
        this._handleSubmit(ev);
      }
    });
  }

  protected updated(changedProps: PropertyValues<this>): void {
    super.updated(changedProps);
    if (changedProps.has("authProvider")) {
      if (this.externalLoginFlow && !this._externalLoginFlowResumed) {
        this._externalLoginFlowResumed = true;
        this._resumeExternalLoginFlow(this.externalLoginFlow);
      } else {
        this._providerChanged(this.authProvider);
      }
    }

    if (!changedProps.has("step") || this.step?.type !== "form") {
      return;
    }

    // 100ms to give all the form elements time to initialize.
    setTimeout(() => {
      if (this._haForm) {
        (this._haForm as any).focus();
      }
    }, 100);
  }

  private _renderForm() {
    switch (this._state) {
      case "step":
        if (this.step == null) {
          return nothing;
        }

        return html`
          ${this._renderStep(this.step)}
          <div class="action">
            <ha-button
              @click=${this._handleSubmit}
              .loading=${this._submitting}
            >
              ${this._actionLabel(this.step)}
            </ha-button>
          </div>
        `;
      case "error":
        return html`
          <ha-alert alert-type="error">
            ${this.localize("ui.panel.page-authorize.form.error", {
              error: this._errorMessage,
            })}
          </ha-alert>
          <div class="action">
            <ha-button @click=${this._startOver}>
              ${this.localize("ui.panel.page-authorize.form.start_over")}
            </ha-button>
          </div>
        `;
      case "loading":
        return html`
          <ha-alert alert-type="info">
            ${this.localize("ui.panel.page-authorize.form.working")}
          </ha-alert>
        `;
      default:
        return nothing;
    }
  }

  private _actionLabel(step: DataEntryFlowStep) {
    switch (step.type) {
      case "form":
        return this.localize("ui.panel.page-authorize.form.next");
      case "external":
        return this.localize("ui.panel.page-authorize.form.continue");
      default:
        return this.localize("ui.panel.page-authorize.form.start_over");
    }
  }

  private _renderStep(step: DataEntryFlowStep) {
    switch (step.type) {
      case "abort":
        return html`
          ${this.localize("ui.panel.page-authorize.abort_intro")}:
          ${this.localize(
            `ui.panel.page-authorize.form.providers.${step.handler[0]}.abort.${step.reason}`
          )}
        `;
      case "external":
        return html`
          <h1>${this.localize("ui.panel.page-authorize.welcome_home")}</h1>
          <p>
            ${this.localize("ui.panel.page-authorize.external_intro", {
              provider: this.authProvider?.name ?? "",
            })}
          </p>
        `;
      case "form":
        return html`
          <h1>
            ${
              !["select_mfa_module", "mfa"].includes(step.step_id)
                ? this.localize("ui.panel.page-authorize.welcome_home")
                : this.localize("ui.panel.page-authorize.just_checking")
            }
          </h1>
          ${this._computeStepDescription(step)}
          ${keyed(
            step.step_id,
            html`<ha-auth-form
              .localize=${this.localize}
              .data=${this._stepData!}
              .schema=${autocompleteLoginFields(step.data_schema)}
              .error=${step.errors}
              .disabled=${this._submitting}
              .computeLabel=${this._computeLabelCallback(step)}
              .computeError=${this._computeErrorCallback(step)}
              @value-changed=${this._stepDataChanged}
            ></ha-auth-form>`
          )}

          <div class="space-between">
            ${
              this.clientId === genClientId() &&
              !["select_mfa_module", "mfa"].includes(step.step_id)
                ? html`
                    <ha-checkbox
                      .checked=${this._storeToken}
                      @change=${this._storeTokenChanged}
                    >
                      ${this.localize("ui.panel.page-authorize.store_token")}
                    </ha-checkbox>
                  `
                : ""
            }
            <a
              class="forgot-password"
              href="https://www.home-assistant.io/docs/locked_out/#forgot-password"
              target="_blank"
              rel="noreferrer noopener"
              >${this.localize("ui.panel.page-authorize.forgot_password")}</a
            >
          </div>
        `;
      default:
        return nothing;
    }
  }

  private _storeTokenChanged(e: CustomEvent<HTMLInputElement>) {
    this._storeToken = (e.currentTarget as HTMLInputElement).checked;
  }

  private async _providerChanged(newProvider?: AuthProvider) {
    // Starting a new flow here always logs in, it never links an account.
    this._linkUserReturnUrl = undefined;

    if (
      this.step &&
      (this.step.type === "form" || this.step.type === "external")
    ) {
      deleteLoginFlow(this.step.flow_id).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("Error delete obsoleted auth flow", err);
      });
    }

    if (newProvider == null) {
      // eslint-disable-next-line no-console
      console.error("No auth provider");
      this._state = "error";
      this._errorMessage = this._unknownError();
      return;
    }

    try {
      const response = await createLoginFlow(this.clientId, this.redirectUri, [
        newProvider.type,
        newProvider.id,
      ]);

      const data = await response.json();

      if (response.ok) {
        this._handleStep(data);
      } else {
        this._state = "error";
        this._errorMessage = data.message;
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("Error starting auth flow", err);
      this._state = "error";
      this._errorMessage = this._unknownError();
    }
  }

  private _stepDataChanged(ev: CustomEvent) {
    this._stepData = ev.detail.value;
  }

  private _computeStepDescription(step: DataEntryFlowStepForm) {
    const resourceKey =
      `ui.panel.page-authorize.form.providers.${step.handler[0]}.step.${step.step_id}.description` as const;
    return this.localize(resourceKey, step.description_placeholders);
  }

  private _computeLabelCallback(step: DataEntryFlowStepForm) {
    // Returns a callback for ha-form to calculate labels per schema object
    return (schema) =>
      this.localize(
        `ui.panel.page-authorize.form.providers.${step.handler[0]}.step.${step.step_id}.data.${schema.name}`
      );
  }

  private _computeErrorCallback(step: DataEntryFlowStepForm) {
    // Returns a callback for ha-form to calculate error messages
    return (error) =>
      this.localize(
        `ui.panel.page-authorize.form.providers.${step.handler[0]}.error.${error}`
      );
  }

  private _unknownError() {
    return this.localize("ui.panel.page-authorize.form.unknown_error");
  }

  private _startOver() {
    this._providerChanged(this.authProvider);
  }

  private async _handleSubmit(ev: Event) {
    ev.preventDefault();
    if (this.step == null) {
      return;
    }
    if (this.step.type === "external") {
      this._startExternalStep(this.step);
      return;
    }
    if (this.step.type !== "form") {
      this._providerChanged(this.authProvider);
      return;
    }

    if (!this._form?.reportValidity()) {
      return;
    }

    this._submitting = true;

    const postData = { ...this._stepData, client_id: this.clientId };

    try {
      const response = await submitLoginFlow(this.step.flow_id, postData);

      const newStep = await response.json();

      if (response.status === 403) {
        this._state = "error";
        this._errorMessage = newStep.message;
        return;
      }

      this._handleStep(newStep);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("Error submitting step", err);
      this._state = "error";
      this._errorMessage = this._unknownError();
    } finally {
      this._submitting = false;
    }
  }

  private _handleStep(step: DataEntryFlowStep) {
    if (step.type === "create_entry") {
      // The auth flow returns an authorization code instead of a config entry
      const code = step.result as unknown as string;

      if (this._linkUserReturnUrl) {
        // Linking needs a signed in user, so the app finishes it for us.
        const url = new URL(this._linkUserReturnUrl, location.origin);

        if (url.origin !== location.origin) {
          this._state = "error";
          this._errorMessage = this._unknownError();
          return;
        }

        url.searchParams.set("link_user_code", code);
        document.location.assign(url.toString());
        return;
      }

      redirectWithAuthCode(
        this.redirectUri!,
        code,
        this.oauth2State,
        this._storeToken
      );
      return;
    }
    this.step = step;
    this._state = "step";
  }

  private _startExternalStep(step: DataEntryFlowStepExternal) {
    const url = sanitizeHttpUrl(step.url);

    if (!url || !this.authProvider) {
      this._state = "error";
      this._errorMessage = this._unknownError();
      return;
    }

    // The external provider sends the browser back to /auth/authorize without
    // the parameters we were opened with, so park them until we return.
    storeExternalLoginFlow({
      flow_id: step.flow_id,
      client_id: this.clientId!,
      redirect_uri: this.redirectUri!,
      oauth2_state: this.oauth2State,
      store_token: this._storeToken,
      auth_provider: {
        type: this.authProvider.type,
        id: this.authProvider.id,
      },
    });

    this._submitting = true;
    document.location.assign(url);
  }

  private async _resumeExternalLoginFlow(flow: ExternalLoginFlow) {
    this._storeToken = flow.store_token;
    this._linkUserReturnUrl = flow.link_user ? flow.return_url : undefined;
    this._state = "loading";
    this._submitting = true;

    try {
      const response = await submitLoginFlow(flow.flow_id, {
        client_id: this.clientId,
      });

      const step = await response.json();

      if (!response.ok) {
        this._state = "error";
        this._errorMessage = step.message;
        return;
      }

      this._handleStep(step);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("Error resuming auth flow", err);
      this._state = "error";
      this._errorMessage = this._unknownError();
    } finally {
      this._submitting = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-auth-flow": HaAuthFlow;
  }
}
