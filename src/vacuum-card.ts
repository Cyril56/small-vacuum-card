import { CSSResultGroup, LitElement, PropertyValues, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  hasConfigOrEntityChanged,
  fireEvent,
  HomeAssistant,
  ServiceCallRequest,
} from 'custom-card-helpers';
import registerTemplates from 'ha-template';
import get from 'lodash/get';
import localize from './localize';
import styles from './styles.css';
import buildConfig from './config';
import {
  Template,
  VacuumCardAction,
  VacuumCardConfig,
  VacuumEntity,
  HassEntity,
  VacuumEntityState,
  VacuumServiceCallParams,
  VacuumActionParams,
} from './types';
import DEFAULT_IMAGE from './vacuum.svg';

registerTemplates();

// String in the right side will be replaced by Rollup
const PKG_VERSION = 'PKG_VERSION_VALUE';

console.info(
  `%c VACUUM-CARD %c ${PKG_VERSION}`,
  'color: white; background: blue; font-weight: 700;',
  'color: blue; background: white; font-weight: 700;',
);

if (!customElements.get('ha-icon-button')) {
  customElements.define(
    'ha-icon-button',
    class extends (customElements.get('paper-icon-button') ?? HTMLElement) {},
  );
}

@customElement('vacuum-card')
export class VacuumCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private config!: VacuumCardConfig;
  @state() private requestInProgress = false;
  @state() private thumbUpdater: ReturnType<typeof setInterval> | null = null;

  static get styles(): CSSResultGroup {
    return styles;
  }

  public static async getConfigElement() {
    await import('./editor');
    return document.createElement('vacuum-card-editor');
  }

  static getStubConfig(_: unknown, entities: string[]) {
    const [vacuumEntity] = entities.filter((eid) => eid.startsWith('vacuum'));

    return {
      entity: vacuumEntity ?? '',
    };
  }

  get entity(): VacuumEntity {
    return this.hass.states[this.config.entity] as VacuumEntity;
  }

  get map(): HassEntity | null {
    if (!this.hass || !this.config.map) {
      return null;
    }
    return this.hass.states[this.config.map];
  }

  public setConfig(config: VacuumCardConfig): void {
    this.config = buildConfig(config);
  }

  public getCardSize(): number {
    return this.config.compact_view ? 3 : 8;
  }

  public shouldUpdate(changedProps: PropertyValues): boolean {
    return hasConfigOrEntityChanged(this, changedProps, false);
  }

  protected updated(changedProps: PropertyValues) {
    if (
      changedProps.get('hass') &&
      changedProps.get('hass').states[this.config.entity].state !==
        this.hass.states[this.config.entity].state
    ) {
      this.requestInProgress = false;
    }
  }

  public connectedCallback() {
    super.connectedCallback();
    if (!this.config.compact_view && this.map) {
      this.requestUpdate();
      this.thumbUpdater = setInterval(
        () => this.requestUpdate(),
        this.config.map_refresh * 1000,
      );
    }
  }

  public disconnectedCallback() {
    super.disconnectedCallback();
    if (this.map && this.thumbUpdater) {
      clearInterval(this.thumbUpdater);
    }
  }

  private handleMore(entityId: string = this.entity.entity_id): void {
    fireEvent(
      this,
      'hass-more-info',
      {
        entityId,
      },
      {
        bubbles: false,
        composed: true,
      },
    );
  }

  private callService(action: VacuumCardAction) {
    const { service, service_data, target } = action;
    const [domain, name] = service.split('.');
    this.hass.callService(domain, name, service_data, target);
  }

  private callVacuumService(
    service: ServiceCallRequest['service'],
    params: VacuumServiceCallParams = { request: true },
    options: ServiceCallRequest['serviceData'] = {},
  ) {
    this.hass.callService('vacuum', service, {
      entity_id: this.config.entity,
      ...options,
    });

    if (params.request) {
      this.requestInProgress = true;
      this.requestUpdate();
    }
  }

  private handleSpeed(e: PointerEvent): void {
    const fan_speed = (<HTMLDivElement>e.target).getAttribute('value');
    this.callVacuumService('set_fan_speed', { request: false }, { fan_speed });
  }

  private handleVacuumAction(
    action: string,
    params: VacuumActionParams = { request: true },
  ) {
    return () => {
      if (!this.config.actions[action]) {
        return this.callVacuumService(params.defaultService || action, params);
      }
      this.callService(this.config.actions[action]);
    };
  }

  private getAttributes(entity: VacuumEntity) {
    const { status, state } = entity.attributes;
    return {
      ...entity.attributes,
      status: status ?? state ?? entity.state,
    };
  }

  /** Nouveau : rendu mode + batterie sur une même ligne */
  private renderModeBattery(): Template {
    const { fan_speed, fan_speed_list, battery_level, battery_icon } =
      this.getAttributes(this.entity);

    const mode = fan_speed ?? this.entity.attributes.mode ?? '';

    return html`
      <div class="mode-battery">
        ${mode
          ? html`<div class="mode">
              <ha-icon icon="mdi:fan"></ha-icon>
              <span>${localize(`source.${mode.toLowerCase()}`) || mode}</span>
            </div>`
          : nothing}
        <div class="battery" @click="${() => this.handleMore()}">
          <ha-icon icon="${battery_icon}"></ha-icon>
          <span>${battery_level}%</span>
        </div>
      </div>
    `;
  }

  private renderMapOrImage(state: VacuumEntityState): Template {
    if (this.config.compact_view) {
      return nothing;
    }

    if (this.map) {
      return this.map && this.map.attributes.entity_picture
        ? html`
            <img
              class="map"
              src="${this.map.attributes.entity_picture}&v=${Date.now()}"
              @click=${() => this.handleMore(this.config.map)}
            />
          `
        : nothing;
    }

    const src =
      this.config.image === 'default' ? DEFAULT_IMAGE : this.config.image;

    return html`
      <img
        class="vacuum ${state}"
        src="${src}"
        @click="${() => this.handleMore()}"
      />
    `;
  }

  private renderStats(state: VacuumEntityState): Template {
    const statsList =
      this.config.stats[state] || this.config.stats.default || [];

    const stats = statsList.map(
      ({ entity_id, attribute, value_template, unit, subtitle }) => {
        if (!entity_id && !attribute) {
          return nothing;
        }

        let state = '';

        if (entity_id && attribute) {
          state = get(this.hass.states[entity_id].attributes, attribute);
        } else if (attribute) {
          state = get(this.entity.attributes, attribute);
        } else if (entity_id) {
          state = this.hass.states[entity_id].state;
        } else {
          return nothing;
        }

        const value = html`
          <ha-template
            hass=${this.hass}
            template=${value_template}
            value=${state}
            variables=${{ value: state }}
          ></ha-template>
        `;

        return html`
          <div class="stats-block" @click="${() => this.handleMore(entity_id)}">
            <span class="stats-value">${value}</span>
            ${unit}
            <div class="stats-subtitle">${subtitle}</div>
          </div>
        `;
      },
    );

    if (!stats.length) {
      return nothing;
    }

    return html`<div class="stats">${stats}</div>`;
  }

  private renderName(): Template {
    const { friendly_name } = this.getAttributes(this.entity);
    if (!this.config.show_name) return nothing;
    return html` <div class="vacuum-name">${friendly_name}</div> `;
  }

  private renderStatus(): Template {
    const { status } = this.getAttributes(this.entity);
    const localizedStatus =
      localize(`status.${status.toLowerCase()}`) || status;

    if (!this.config.show_status) return nothing;

    return html`
      <div class="status">
        <span class="status-text" alt=${localizedStatus}>
          ${localizedStatus}
        </span>
        <ha-circular-progress
          .indeterminate=${this.requestInProgress}
          size="small"
        ></ha-circular-progress>
      </div>
    `;
  }

  /** Toolbar modifiée : icônes seules si en marche */
  private renderToolbar(state: VacuumEntityState): Template {
    if (!this.config.show_toolbar) {
      return nothing;
    }

    const runningStates = [
      'on',
      'auto',
      'spot',
      'edge',
      'single_room',
      'cleaning',
    ];
    const isRunning = runningStates.includes(state);

    if (isRunning) {
      return html`
        <div class="toolbar">
          <ha-icon-button
            label="${localize('common.pause')}"
            @click="${this.handleVacuumAction('pause')}"
            ><ha-icon icon="hass:pause"></ha-icon>
          </ha-icon-button>
          <ha-icon-button
            label="${localize('common.stop')}"
            @click="${this.handleVacuumAction('stop')}"
            ><ha-icon icon="hass:stop"></ha-icon>
          </ha-icon-button>
          <ha-icon-button
            label="${localize('common.return_to_base')}"
            @click="${this.handleVacuumAction('return_to_base')}"
            ><ha-icon icon="hass:home-map-marker"></ha-icon>
          </ha-icon-button>
        </div>
      `;
    }

    // autres états -> toolbar existante (dock, locate, etc.)
    return html`
      <div class="toolbar">
        <ha-icon-button
          label="${localize('common.start')}"
          @click="${this.handleVacuumAction('start')}"
          ><ha-icon icon="hass:play"></ha-icon>
        </ha-icon-button>
        <ha-icon-button
          label="${localize('common.locate')}"
          @click="${this.handleVacuumAction('locate', { request: false })}"
          ><ha-icon icon="mdi:map-marker"></ha-icon>
        </ha-icon-button>
        <ha-icon-button
          label="${localize('common.return_to_base')}"
          @click="${this.handleVacuumAction('return_to_base')}"
          ><ha-icon icon="hass:home-map-marker"></ha-icon>
        </ha-icon-button>
      </div>
    `;
  }

  private renderUnavailable(): Template {
    return html`
      <ha-card>
        <div class="preview not-available">
          <div class="metadata">
            <div class="not-available">
              ${localize('common.not_available')}
            </div>
          <div>
        </div>
      </ha-card>
    `;
  }

  protected render(): Template {
    if (!this.entity) {
      return this.renderUnavailable();
    }

    return html`
      <ha-card>
        <div class="preview">
          <div class="header">
            ${this.renderModeBattery()}
            <ha-icon-button
              class="more-info"
              icon="mdi:dots-vertical"
              ?more-info="true"
              @click="${() => this.handleMore()}"
              ><ha-icon icon="mdi:dots-vertical"></ha-icon>
            </ha-icon-button>
          </div>

          ${this.renderMapOrImage(this.entity.state)}

          <div class="metadata">
            ${this.renderName()} ${this.renderStatus()}
          </div>

          ${this.renderStats(this.entity.state)}
        </div>

        ${this.renderToolbar(this.entity.state)}
      </ha-card>
    `;
  }
}

declare global {
  interface Window {
    customCards?: unknown[];
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  preview: true,
  type: 'vacuum-card',
  name: localize('common.name'),
  description: localize('common.description'),
});
