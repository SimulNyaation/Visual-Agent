import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { agentStatusOf, type TerminalInfo } from "../../domain/terminals";
import { fakeCore } from "../../test/fakeCore";
import { fakeScreens } from "../../test/fakeScreen";
import { createFileTreeStore } from "../fileTree/fileTreeStore";
import { createLayoutStore } from "../layout/layoutStore";
import { ProjectWorkspace } from "../projectTabs/ProjectWorkspace";
import { createProjectTabsStore } from "../projectTabs/projectTabsStore";
import { createTerminalStore } from "./terminalStore";

const ALPHA = "C:\\work\\alpha";
const BETA = "C:\\work\\beta";

async function openProject(picks: string[] = [ALPHA]) {
  const core = fakeCore({ picks });
  const screens = fakeScreens();
  const store = createProjectTabsStore(core.api);
  const fileStore = createFileTreeStore(core.api, store);
  const terminalStore = createTerminalStore(core.api, store, screens.create);
  await store.load();
  render(<ProjectWorkspace store={store} fileStore={fileStore} terminalStore={terminalStore} layoutStore={createLayoutStore(core.api)} captionWidth={138} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "폴더 선택" }));
  for (let extra = 1; extra < picks.length; extra++) {
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));
  }
  await waitFor(() => expect(rows()).toHaveLength(1));
  return { user, terminals: core.terminals };
}

const agentPane = () => screen.getByRole("region", { name: "에이전트 칸" });
const rows = () => within(agentPane()).queryAllByRole("listitem");
/** 줄마다 보이는 상태 글자. 없으면 null */
const statuses = () => rows().map((item) => item.querySelector(".agentrow__status")?.textContent ?? null);
const waitForStatuses = (expected: (string | null)[]) => waitFor(() => expect(statuses()).toEqual(expected));
const dotOf = (index: number) => rows()[index]!.querySelector(".agentrow__dot")!;
const projectTab = (name: string) => screen.getByRole("tab", { name });
const attention = (name: string) => projectTab(name).querySelector(".tab__attention");

describe("에이전트 상태: 규칙", () => {
  const terminal = (patch: Partial<TerminalInfo>): TerminalInfo => ({
    id: "p1",
    tabId: "t1",
    shell: "pwsh",
    name: "PowerShell 1",
    agent: "Claude Code",
    busy: true,
    working: false,
    finished: 0,
    ...patch,
  });

  it("에이전트가 없으면 상태가 없고, 작업 중이 아니면 입력 대기다 (AC1)", () => {
    expect(agentStatusOf(terminal({ agent: "", busy: false }), 0)).toBeNull();
    expect(agentStatusOf(terminal({}), 0)).toBe("waiting");
    expect(agentStatusOf(terminal({ working: true }), 0)).toBe("working");
  });

  it("확인한 것보다 마친 작업이 많으면 끝남이고, 다시 작업을 시작하면 작업 중이다 (AC5)", () => {
    expect(agentStatusOf(terminal({ finished: 1 }), 0)).toBe("finished");
    expect(agentStatusOf(terminal({ finished: 1 }), 1)).toBe("waiting");
    expect(agentStatusOf(terminal({ finished: 3 }), 2)).toBe("finished");
    expect(agentStatusOf(terminal({ finished: 1, working: true }), 0)).toBe("working");
  });
});

describe("에이전트 상태: 에이전트 칸", () => {
  it("에이전트가 없는 줄에는 상태가 없고, 실행하면 입력 대기, 작업하면 작업 중이 된다 (AC1, AC2, AC3)", async () => {
    const { terminals } = await openProject();
    const id = terminals.list()[0]!.id;
    expect(statuses()).toEqual([null]);

    terminals.setAgent(id, "Claude Code");
    await waitForStatuses(["입력 대기"]);
    expect(dotOf(0)).toHaveClass("agentrow__dot--waiting");

    terminals.setWorking(id, true);
    await waitForStatuses(["작업 중"]);
    expect(dotOf(0)).toHaveClass("agentrow__dot--working");

    terminals.setWorking(id, false);
    await waitForStatuses(["입력 대기"]);
  });

  it("보고 있는 터미널에서 마친 작업은 끝남을 거치지 않고 입력 대기가 된다 (AC5)", async () => {
    const { terminals } = await openProject();
    const id = terminals.list()[0]!.id;
    terminals.setAgent(id, "Claude Code");
    terminals.setWorking(id, true);
    await waitForStatuses(["작업 중"]);
    terminals.finishWork(id);
    await waitForStatuses(["입력 대기"]);
  });

  it("보고 있지 않은 터미널이 작업을 마치면 끝남이 되고, 그 줄을 눌러 보면 입력 대기가 된다 (AC5)", async () => {
    const { user, terminals } = await openProject();
    const first = terminals.list()[0]!.id;
    terminals.setAgent(first, "Claude Code");
    terminals.setWorking(first, true);
    await waitForStatuses(["작업 중"]);
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitForStatuses(["작업 중", null]);

    terminals.finishWork(first);
    await waitForStatuses(["끝남", null]);
    expect(dotOf(0)).toHaveClass("agentrow__dot--finished");

    // 다시 작업을 시작하면 작업 중이고, 또 마치면 다시 끝남이다
    terminals.setWorking(first, true);
    await waitForStatuses(["작업 중", null]);
    terminals.finishWork(first);
    await waitForStatuses(["끝남", null]);

    await user.click(screen.getByRole("button", { name: "PowerShell 1, Claude Code 실행 중" }));
    await waitForStatuses(["입력 대기", null]);
    // 한 번 본 것은 다른 터미널로 가도 끝남으로 돌아가지 않는다
    await user.click(screen.getByRole("button", { name: "PowerShell 2" }));
    expect(statuses()).toEqual(["입력 대기", null]);
  });

  it("에이전트를 끝내면 상태가 사라지고, 다시 실행하면 끝남이 남아 있지 않다 (AC8)", async () => {
    const { user, terminals } = await openProject();
    const first = terminals.list()[0]!.id;
    terminals.setAgent(first, "Claude Code");
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitForStatuses(["입력 대기", null]);
    terminals.finishWork(first);
    await waitForStatuses(["끝남", null]);

    terminals.setAgent(first, "");
    await waitForStatuses([null, null]);
    terminals.setAgent(first, "Claude Code");
    await waitForStatuses(["입력 대기", null]);
  });

  it("상태는 줄을 읽어 주는 이름을 바꾸지 않고 설명으로 덧붙는다 (AC9)", async () => {
    const { terminals } = await openProject();
    const id = terminals.list()[0]!.id;
    terminals.setAgent(id, "Claude Code");
    terminals.setWorking(id, true);
    await waitForStatuses(["작업 중"]);
    const row = screen.getByRole("button", { name: "PowerShell 1, Claude Code 실행 중" });
    expect(row).toHaveAccessibleDescription("작업 중");
    expect(within(agentPane()).getByRole("button", { name: "PowerShell 1 닫기" })).toBeInTheDocument();
  });
});

describe("에이전트 상태: 프로젝트 탭", () => {
  it("다른 프로젝트 탭의 에이전트가 작업을 마치면 그 탭에 점이 표시되고, 가서 보면 사라진다 (AC6)", async () => {
    const { user, terminals } = await openProject([ALPHA, BETA]);
    // 지금 보고 있는 것은 beta. alpha의 터미널은 탭을 본 적이 있어야 뜬다
    await user.click(projectTab("alpha"));
    await waitFor(() => expect(terminals.list()).toHaveLength(2));
    const alpha = terminals.list().find((terminal) => terminal.tabId === "t1")!.id;
    terminals.setAgent(alpha, "Claude Code");
    terminals.setWorking(alpha, true);
    await waitForStatuses(["작업 중"]);

    await user.click(projectTab("beta"));
    await waitForStatuses([null]);
    expect(attention("alpha")).toBeNull();

    terminals.finishWork(alpha);
    await waitFor(() => expect(attention("alpha")).not.toBeNull());
    expect(attention("beta")).toBeNull();
    expect(projectTab("alpha")).toHaveAccessibleDescription("작업을 마친 에이전트가 있습니다");

    await user.click(projectTab("alpha"));
    await waitFor(() => expect(attention("alpha")).toBeNull());
    await waitForStatuses(["입력 대기"]);
  });

  it("보고 있는 프로젝트 탭에서도, 보고 있지 않은 터미널이 마치면 그 탭에 점이 표시된다 (AC6)", async () => {
    const { user, terminals } = await openProject();
    const first = terminals.list()[0]!.id;
    terminals.setAgent(first, "Claude Code");
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitForStatuses(["입력 대기", null]);
    terminals.finishWork(first);
    await waitFor(() => expect(attention("alpha")).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "PowerShell 1, Claude Code 실행 중" }));
    await waitFor(() => expect(attention("alpha")).toBeNull());
  });
});
