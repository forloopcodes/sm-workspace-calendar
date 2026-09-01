import { lazy, Suspense, useMemo, type ReactNode } from "react";
import type {
  PluginInitialization,
  PluginLoadingState,
  PluginModule,
  PluginPersistence,
  PluginSimulation,
} from "@soft-machine/sdk";
import { registerPluginModule, useOpenPanelSafe } from "@soft-machine/sdk";

const LazyCalendarRoot = lazy(() =>
  import("./CalendarRoot").then((module) => ({ default: module.CalendarRoot }))
);

function Provider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function CalendarPanel() {
  return (
    <Suspense fallback={null}>
      <LazyCalendarRoot />
    </Suspense>
  );
}

function useLoadingState(): PluginLoadingState {
  return useMemo(() => ({ isLoading: false, error: null }), []);
}

function usePersistence(): PluginPersistence {
  return useMemo(
    () => ({
      getState: () => null,
      restoreState: () => {},
      getMetrics: () => ({ primaryCount: 0, primaryLabel: "events", generation: 1 }),
      getMetadataString: () => "Collaborative workspace calendar",
      generation: 1,
      isReady: true,
      setReady: () => {},
    }),
    []
  );
}

function useSimulation(): PluginSimulation {
  return useMemo(
    () => ({ isRunning: false, run: () => {}, stop: () => {}, step: () => {}, reset: () => {} }),
    []
  );
}

function useInitialization(): PluginInitialization {
  return useMemo(() => ({ clear: () => {}, refresh: () => {} }), []);
}

function useCommands() {
  const openPanel = useOpenPanelSafe();
  return useMemo(
    () => [
      {
        id: "calendar.open",
        label: "Calendar: Open",
        description: "Open the workspace calendar",
        action: () =>
          openPanel?.({
            panelTypeId: "calendar-main",
            mode: "findOrOpen",
            placement: "float",
          }),
      },
    ],
    [openPanel]
  );
}

const pluginModule: PluginModule = {
  id: "calendar",
  meta: {
    id: "calendar",
    label: "Calendar",
    shortLabel: "CAL",
    color: "#4A90D9",
    description: "A collaborative workspace calendar.",
    integrations: [
      {
        site: "googleapis.com",
        description: "Sync events with Google Calendar",
        docsUrl: "https://console.cloud.google.com/apis/credentials",
      },
      {
        site: "graph.microsoft.com",
        description: "Sync events with Microsoft Outlook Calendar",
        docsUrl: "https://entra.microsoft.com/",
      },
    ],
    panels: [
      {
        id: "calendar-main",
        title: "Calendar",
        layout: { width: 960, minWidth: 220 },
      },
    ],
  },
  Provider,
  panels: [
    {
      id: "calendar-main",
      title: "Calendar",
      component: CalendarPanel,
      defaultVisible: true,
      layout: { width: 960, minWidth: 220 },
    },
  ],
  toolbar: { component: () => null },
  useLoadingState,
  usePersistence,
  useSimulation,
  useInitialization,
  useCommands,
};

registerPluginModule(pluginModule);

export default pluginModule;
