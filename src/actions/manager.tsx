import React from "react";
import {
  Action,
  UpdaterFn,
  ActionName,
  ActionResult,
  PanelComponentProps,
  ActionSource,
} from "./types";
import { ExcalidrawElement, ExcalidrawLayer } from "../element/types";
import { AppClassProperties, AppState } from "../types";
import { trackEvent } from "../analytics";

const trackAction = (
  action: Action,
  source: ActionSource,
  appState: Readonly<AppState>,
  elements: readonly ExcalidrawElement[],
  layers: readonly ExcalidrawLayer[],
  app: AppClassProperties,
  value: any,
) => {
  if (action.trackEvent) {
    try {
      if (typeof action.trackEvent === "object") {
        const shouldTrack = action.trackEvent.predicate
          ? action.trackEvent.predicate(appState, elements, value)
          : true;
        if (shouldTrack) {
          trackEvent(
            action.trackEvent.category,
            action.trackEvent.action || action.name,
            `${source} (${app.device.isMobile ? "mobile" : "desktop"})`,
          );
        }
      }
    } catch (error) {
      console.error("error while logging action:", error);
    }
  }
};

export class ActionManager {
  actions = {} as Record<ActionName, Action>;

  updater: (actionResult: ActionResult | Promise<ActionResult>) => void;

  getAppState: () => Readonly<AppState>;
  getElementsIncludingDeleted: () => readonly ExcalidrawElement[];
  getLayers: () => readonly ExcalidrawLayer[];

  app: AppClassProperties;

  constructor(
    updater: UpdaterFn,
    getAppState: () => AppState,
    getElementsIncludingDeleted: () => readonly ExcalidrawElement[],
    getLayers: () => readonly ExcalidrawLayer[],
    app: AppClassProperties,
  ) {
    this.updater = (actionResult) => {
      if (actionResult && "then" in actionResult) {
        actionResult.then((actionResult) => {
          return updater(actionResult);
        });
      } else {
        return updater(actionResult);
      }
    };
    this.getAppState = getAppState;
    this.getElementsIncludingDeleted = getElementsIncludingDeleted;
    this.getLayers = getLayers;
    this.app = app;
  }

  registerAction(action: Action) {
    this.actions[action.name] = action;
  }

  registerAll(actions: readonly Action[]) {
    actions.forEach((action) => this.registerAction(action));
  }

  handleKeyDown(event: React.KeyboardEvent | KeyboardEvent) {
    const canvasActions = this.app.props.UIOptions.canvasActions;
    const data = Object.values(this.actions)
      .sort((a, b) => (b.keyPriority || 0) - (a.keyPriority || 0))
      .filter(
        (action) =>
          (action.name in canvasActions
            ? canvasActions[action.name as keyof typeof canvasActions]
            : true) &&
          action.keyTest &&
          action.keyTest(
            event,
            this.getAppState(),
            this.getElementsIncludingDeleted(),
          ),
      );

    if (data.length !== 1) {
      if (data.length > 1) {
        console.warn("Canceling as multiple actions match this shortcut", data);
      }
      return false;
    }

    const action = data[0];

    if (this.getAppState().viewModeEnabled && action.viewMode !== true) {
      return false;
    }

    const elements = this.getElementsIncludingDeleted();
    const layers = this.getLayers();
    const appState = this.getAppState();
    const value = null;

    trackAction(action, "keyboard", appState, elements, layers, this.app, null);

    event.preventDefault();
    event.stopPropagation();
    this.updater(data[0].perform(elements, layers, appState, value, this.app));
    return true;
  }

  executeAction(action: Action, source: ActionSource = "api") {
    const elements = this.getElementsIncludingDeleted();
    const layers = this.getLayers();
    const appState = this.getAppState();
    const value = null;

    trackAction(action, source, appState, elements, layers, this.app, value);

    this.updater(action.perform(elements, layers, appState, value, this.app));
  }

  /**
   * @param data additional data sent to the PanelComponent
   */
  renderAction = (name: ActionName, data?: PanelComponentProps["data"]) => {
    const canvasActions = this.app.props.UIOptions.canvasActions;

    if (
      this.actions[name] &&
      "PanelComponent" in this.actions[name] &&
      (name in canvasActions
        ? canvasActions[name as keyof typeof canvasActions]
        : true)
    ) {
      const action = this.actions[name];
      const PanelComponent = action.PanelComponent!;
      PanelComponent.displayName = "PanelComponent";
      const elements = this.getElementsIncludingDeleted();
      const layers = this.getLayers();
      const appState = this.getAppState();

      const updateData = (formState?: any) => {
        trackAction(
          action,
          "ui",
          appState,
          elements,
          layers,
          this.app,
          formState,
        );

        this.updater(
          action.perform(
            this.getElementsIncludingDeleted(),
            this.getLayers(),
            this.getAppState(),
            formState,
            this.app,
          ),
        );
      };

      return (
        <PanelComponent
          elements={this.getElementsIncludingDeleted()}
          layers={this.getLayers()}
          appState={this.getAppState()}
          updateData={updateData}
          appProps={this.app.props}
          data={data}
        />
      );
    }

    return null;
  };

  isActionEnabled = (action: Action) => {
    const elements = this.getElementsIncludingDeleted();
    const layers = this.getLayers();
    const appState = this.getAppState();

    return (
      !action.predicate ||
      action.predicate(elements, layers, appState, this.app.props, this.app)
    );
  };
}
