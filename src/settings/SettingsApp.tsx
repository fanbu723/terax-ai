import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WindowControls } from "@/components/WindowControls";
import { useLocale, useT } from "@/i18n/useT";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import type { SettingsTab } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { WindowActivityBridge } from "@/modules/theme";
import {
  AiScanIcon,
  InformationCircleIcon,
  KeyboardIcon,
  PaintBoardIcon,
  ServerStack03Icon,
  Settings01Icon,
  SourceCodeIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { lazy, Suspense, type JSX, useEffect, useState } from "react";
import { AboutSection } from "./sections/AboutSection";
import { AgentsSection } from "./sections/AgentsSection";
import { EditorSection } from "./sections/EditorSection";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { ThemesSection } from "./sections/ThemesSection";

// The remote tab pulls in host management and dialogs; load the section on
// first visit so the settings startup graph stays as small as before.
const RemoteSection = lazy(() =>
  import("./sections/RemoteSection").then((m) => ({
    default: m.RemoteSection,
  })),
);

function RemoteSectionEntry() {
  return (
    <Suspense fallback={null}>
      <RemoteSection />
    </Suspense>
  );
}

const TABS: {
  id: SettingsTab;
  label: string;
  icon: typeof Settings01Icon;
  component: () => JSX.Element;
}[] = [
  {
    id: "general",
    label: "General",
    icon: Settings01Icon,
    component: GeneralSection,
  },
  {
    id: "editor",
    label: "Editor",
    icon: SourceCodeIcon,
    component: EditorSection,
  },
  {
    id: "themes",
    label: "Themes",
    icon: PaintBoardIcon,
    component: ThemesSection,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: KeyboardIcon,
    component: ShortcutsSection,
  },
  { id: "models", label: "Models", icon: AiScanIcon, component: ModelsSection },
  {
    id: "agents",
    label: "Agents",
    icon: UserMultiple02Icon,
    component: AgentsSection,
  },
  {
    id: "remote",
    label: "Remote",
    icon: ServerStack03Icon,
    component: RemoteSectionEntry,
  },
  {
    id: "about",
    label: "About",
    icon: InformationCircleIcon,
    component: AboutSection,
  },
];

const VALID_TABS: SettingsTab[] = [
  "general",
  "editor",
  "themes",
  "shortcuts",
  "models",
  "agents",
  "remote",
  "about",
];

function readInitialTab(): SettingsTab {
  if (typeof window === "undefined") return "general";
  const url = new URL(window.location.href);
  const t = url.searchParams.get("tab");
  // Back-compat: legacy "ai" / "connections" → "models".
  if (t === "ai" || t === "connections") return "models";
  if (t && (VALID_TABS as string[]).includes(t)) return t as SettingsTab;
  return "general";
}

export function SettingsApp() {
  const [active, setActive] = useState<SettingsTab>(readInitialTab);
  const locale = useLocale();
  const t = useT();
  const init = usePreferencesStore((s) => s.init);
  const ActiveSection = TABS.find((t) => t.id === active)?.component;

  useEffect(() => {
    void init();
  }, [init]);

  // The native title is created in Rust as "Settings"; localize it once the
  // pack is loaded and keep it in step when the language changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: t is a stable module function; locale is what changes.
  useEffect(() => {
    const title = `${t("Settings")} — Terax`;
    document.title = title;
    void getCurrentWebviewWindow()
      .setTitle(title)
      .catch(() => {});
  }, [locale]);

  useEffect(() => {
    const apply = (detail: string) => {
      if (detail === "ai" || detail === "connections") {
        setActive("models");
        return;
      }
      if ((VALID_TABS as string[]).includes(detail)) {
        setActive(detail as SettingsTab);
      }
    };
    const unlistenPromise = getCurrentWebviewWindow().listen<string>(
      "terax:settings-tab",
      (e) => apply(e.payload),
    );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
      <header
        data-tauri-drag-region
        className={`flex h-11 shrink-0 items-center border-b border-border/60 bg-card/60 ${
          IS_MAC ? "pr-3 pl-22" : "pr-0 pl-3"
        }`}
      >
        <Tabs
          value={active}
          onValueChange={(v) => setActive(v as SettingsTab)}
          orientation="horizontal"
          className="flex-1 items-center"
          data-tauri-drag-region
        >
          <TabsList className="mx-auto h-7 bg-muted/40 px-2">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="h-6 gap-1.5 px-2.5 text-[11.5px]"
              >
                <HugeiconsIcon icon={tab.icon} size={12} strokeWidth={1.75} />
                <span>{t(tab.label)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {USE_CUSTOM_WINDOW_CONTROLS && <WindowControls closeOnly />}
      </header>
      <WindowActivityBridge />
      <Toaster position="bottom-right" />

      <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto w-full max-w-160">
          {ActiveSection && <ActiveSection />}
        </div>
      </main>
    </div>
  );
}
