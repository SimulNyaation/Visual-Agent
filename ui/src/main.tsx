import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@xterm/xterm/css/xterm.css";
import "../../design/theme-kirin.css";
import "./styles/app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { createApiClient } from "./data/apiClient";
import { readHostInfo } from "./data/hostInfo";
import { createDocumentStore } from "./features/documents/documentStore";
import { createFileTreeStore } from "./features/fileTree/fileTreeStore";
import { createLayoutStore } from "./features/layout/layoutStore";
import { createProjectTabsStore } from "./features/projectTabs/projectTabsStore";
import { createTerminalStore } from "./features/terminals/terminalStore";
import { createXtermScreen } from "./ui/xtermScreen";

const host = readHostInfo();
const api = createApiClient(host.token);
const store = createProjectTabsStore(api);
const fileStore = createFileTreeStore(api, store);
const terminalStore = createTerminalStore(api, store, createXtermScreen);
const layoutStore = createLayoutStore(api);
const documentStore = createDocumentStore(api, store);
void store.load();
void layoutStore.load();

const root = document.getElementById("root");
if (!root) throw new Error("index.html에 #root 요소가 없습니다");
createRoot(root).render(
  <StrictMode>
    <App
      store={store}
      fileStore={fileStore}
      terminalStore={terminalStore}
      layoutStore={layoutStore}
      documentStore={documentStore}
      captionWidth={host.captionWidth}
    />
  </StrictMode>,
);
