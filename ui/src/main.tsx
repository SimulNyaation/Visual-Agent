import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "../../design/theme-kirin.css";
import "./styles/app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { createApiClient } from "./data/apiClient";
import { readHostInfo } from "./data/hostInfo";
import { createFileTreeStore } from "./features/fileTree/fileTreeStore";
import { createProjectTabsStore } from "./features/projectTabs/projectTabsStore";

const host = readHostInfo();
const api = createApiClient(host.token);
const store = createProjectTabsStore(api);
const fileStore = createFileTreeStore(api, store);
void store.load();

const root = document.getElementById("root");
if (!root) throw new Error("index.html에 #root 요소가 없습니다");
createRoot(root).render(
  <StrictMode>
    <App store={store} fileStore={fileStore} captionWidth={host.captionWidth} />
  </StrictMode>,
);
