import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { clampAgentShare, clampSidebarWidth, parseLayout, type Layout } from "../../domain/layout";
import { fakeCore } from "../../test/fakeCore";
import { fakeScreens } from "../../test/fakeScreen";
import { createFileTreeStore } from "../fileTree/fileTreeStore";
import { ProjectWorkspace } from "../projectTabs/ProjectWorkspace";
import { createProjectTabsStore } from "../projectTabs/projectTabsStore";
import { createTerminalStore } from "../terminals/terminalStore";
import { createLayoutStore } from "./layoutStore";

const ALPHA = "C:\\work\\alpha";

async function openProject(layout?: Layout) {
  const core = fakeCore({ picks: [ALPHA], layout });
  const store = createProjectTabsStore(core.api);
  const layoutStore = createLayoutStore(core.api);
  await store.load();
  await layoutStore.load();
  render(
    <ProjectWorkspace
      store={store}
      fileStore={createFileTreeStore(core.api, store)}
      terminalStore={createTerminalStore(core.api, store, fakeScreens().create)}
      layoutStore={layoutStore}
      captionWidth={138}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "폴더 선택" }));
  return { user, core, layoutStore };
}

const sidebar = () => screen.getByRole("complementary", { name: "하이어라키" });
const pane = (title: string) => screen.getByRole("region", { name: `${title} 칸` });
const sidebarSplitter = () => screen.getByRole("separator", { name: "사이드바 너비 조절" });
const paneSplitter = () => screen.queryByRole("separator", { name: "에이전트 칸과 파일 칸의 높이 조절" });

describe("크기의 한계", () => {
  it("사이드바는 180px보다 좁아지지 않고, 작업 영역이 320px보다 좁아질 만큼 넓어지지 않는다 (AC3)", () => {
    expect(clampSidebarWidth(100, 1280)).toBe(180);
    expect(clampSidebarWidth(-50, 1280)).toBe(180);
    expect(clampSidebarWidth(300.4, 1280)).toBe(300);
    expect(clampSidebarWidth(2000, 1280)).toBe(960);
    // 가장 작은 앱 창(640px)에서도 사이드바 180px는 남는다
    expect(clampSidebarWidth(500, 640)).toBe(320);
    expect(clampSidebarWidth(500, 400)).toBe(180);
  });

  it("어느 칸도 제목 줄과 항목 두 줄(86px)보다 작아지지 않는다 (AC7)", () => {
    expect(clampAgentShare(0.5, 600)).toBe(0.5);
    expect(clampAgentShare(0, 860)).toBeCloseTo(0.1);
    expect(clampAgentShare(1, 860)).toBeCloseTo(0.9);
    expect(clampAgentShare(-3, 430)).toBeCloseTo(0.2);
    // 두 칸을 다 담을 수 없을 만큼 낮으면 반반
    expect(clampAgentShare(0.9, 150)).toBe(0.5);
    expect(clampAgentShare(0.9, 0)).toBe(0.5);
  });

  it("코어의 응답이 약속한 모양이 아니면 받지 않는다", () => {
    expect(parseLayout({ sidebarWidth: 300, agentShare: 0.4 })).toEqual({ sidebarWidth: 300, agentShare: 0.4 });
    expect(parseLayout({ sidebarWidth: "300", agentShare: 0.4 })).toBeUndefined();
    expect(parseLayout({ sidebarWidth: 300 })).toBeUndefined();
    expect(parseLayout({ sidebarWidth: Number.NaN, agentShare: 0.4 })).toBeUndefined();
    expect(parseLayout(null)).toBeUndefined();
  });
});

describe("크기 조절", () => {
  it("처음에는 사이드바 240px, 두 칸 반반이다 (AC10)", async () => {
    await openProject();
    expect(sidebar().style.width).toBe("240px");
    expect(pane("에이전트").style.flexGrow).toBe("0.5");
    expect(pane("파일").style.flexGrow).toBe("0.5");
  });

  it("코어가 기억하고 있는 너비와 비율로 뜬다 (AC11)", async () => {
    await openProject({ sidebarWidth: 320, agentShare: 0.25 });
    expect(sidebar().style.width).toBe("320px");
    expect(pane("에이전트").style.flexGrow).toBe("0.25");
    expect(pane("파일").style.flexGrow).toBe("0.75");
  });

  it("코어에서 배치를 읽지 못하면 처음 값으로 뜬다 (AC12)", async () => {
    const core = fakeCore({ picks: [ALPHA] });
    const layoutStore = createLayoutStore({ ...core.api, fetchLayout: () => Promise.reject(new Error("끊김")) });
    await layoutStore.load();
    expect(layoutStore.getSnapshot()).toEqual({ sidebarWidth: 240, agentShare: 0.5 });
  });

  it("사이드바 경계에서 좌우 방향키를 누르면 16px씩 움직이고, 한계에서 멈추며, 코어에 기억된다 (AC3, AC14)", async () => {
    const { user, core } = await openProject();
    sidebarSplitter().focus();
    await user.keyboard("{ArrowRight}");
    expect(sidebar().style.width).toBe("256px");
    expect(sidebarSplitter()).toHaveAttribute("aria-valuenow", "256");
    await waitFor(() => expect(core.layout().sidebarWidth).toBe(256));

    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(sidebar().style.width).toBe("180px");
    // 위·아래 키는 세로 경계를 움직이지 않는다
    await user.keyboard("{ArrowUp}{ArrowDown}");
    expect(sidebar().style.width).toBe("180px");
    await waitFor(() => expect(core.layout().sidebarWidth).toBe(180));
  });

  it("경계를 더블클릭하면 처음 값으로 돌아가고 코어에 기억된다 (AC10)", async () => {
    const { core } = await openProject({ sidebarWidth: 400, agentShare: 0.8 });
    fireEvent.doubleClick(sidebarSplitter());
    expect(sidebar().style.width).toBe("240px");
    await waitFor(() => expect(core.layout()).toEqual({ sidebarWidth: 240, agentShare: 0.8 }));

    const panes = paneSplitter();
    expect(panes).not.toBeNull();
    if (panes) fireEvent.doubleClick(panes);
    expect(pane("에이전트").style.flexGrow).toBe("0.5");
    await waitFor(() => expect(core.layout()).toEqual({ sidebarWidth: 240, agentShare: 0.5 }));
  });

  it("칸의 몫은 방향키로 16px만큼씩 바뀌고, 가장 작은 높이에서 멈춘다 (AC7, AC14)", async () => {
    const core = fakeCore({ picks: [ALPHA] });
    const layoutStore = createLayoutStore(core.api);
    layoutStore.nudgePanes(1, 400);
    expect(layoutStore.getSnapshot().agentShare).toBeCloseTo(0.54);
    layoutStore.nudgePanes(-1, 400);
    layoutStore.nudgePanes(-1, 400);
    expect(layoutStore.getSnapshot().agentShare).toBeCloseTo(0.46);

    layoutStore.resizePanes(0.01, 400);
    expect(layoutStore.getSnapshot().agentShare).toBeCloseTo(86 / 400);
    layoutStore.resizePanes(0.99, 400);
    expect(layoutStore.getSnapshot().agentShare).toBeCloseTo(1 - 86 / 400);
    // 끄는 동안에는 기억시키지 않고, 끝났을 때 한 번 기억시킨다
    expect(core.layout().agentShare).not.toBeCloseTo(1 - 86 / 400);
    await layoutStore.save();
    expect(core.layout().agentShare).toBeCloseTo(1 - 86 / 400);
  });

  it("한 칸을 접으면 칸 경계가 없어지고, 다시 펼치면 접기 전의 비율로 돌아온다 (AC9)", async () => {
    const { user } = await openProject({ sidebarWidth: 240, agentShare: 0.3 });
    expect(paneSplitter()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "파일" }));
    expect(paneSplitter()).not.toBeInTheDocument();
    // 접힌 칸은 남는 자리를 나눠 갖지 않고, 펼쳐진 칸이 모두 쓴다
    expect(pane("파일").style.flexGrow).toBe("");
    expect(pane("에이전트").style.flexGrow).toBe("1");

    await user.click(screen.getByRole("button", { name: "파일" }));
    expect(paneSplitter()).toBeInTheDocument();
    expect(pane("에이전트").style.flexGrow).toBe("0.3");
    expect(pane("파일").style.flexGrow).toBe("0.7");

    await user.click(screen.getByRole("button", { name: "에이전트" }));
    expect(paneSplitter()).not.toBeInTheDocument();
  });

  it("폴더를 찾을 수 없는 프로젝트 탭에서도 경계는 그대로 있다", async () => {
    const core = fakeCore({ picks: ["C:\\work\\gone"], missing: ["C:\\work\\gone"] });
    const store = createProjectTabsStore(core.api);
    await store.load();
    render(
      <ProjectWorkspace
        store={store}
        fileStore={createFileTreeStore(core.api, store)}
        terminalStore={createTerminalStore(core.api, store, fakeScreens().create)}
        layoutStore={createLayoutStore(core.api)}
        captionWidth={138}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "폴더 선택" }));
    expect(sidebarSplitter()).toBeInTheDocument();
    expect(paneSplitter()).toBeInTheDocument();
  });
});
