import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { agentStatusOf, parseTerminalEvents, subAgentKind, subAgentTitle, type TerminalInfo } from "../../domain/terminals";
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
/** 터미널 줄 (하위 에이전트 줄은 세지 않는다) */
const rows = () => [...agentPane().querySelectorAll<HTMLElement>(".agentrow")];
const statuses = () => rows().map((item) => item.querySelector(".agentrow__status")?.textContent ?? null);
/** 터미널 줄마다 그 아래에 보이는 하위 에이전트 줄의 글자 */
const subRows = () => rows().map((item) => [...item.querySelectorAll(".subagent")].map((sub) => sub.textContent));
const projectTab = (name: string) => screen.getByRole("tab", { name });
const attention = (name: string) => projectTab(name).querySelector(".tab__attention");

const explore = { id: "a1", type: "Explore", description: "로그인 코드 찾기" };
const tests = { id: "a2", type: "general-purpose", description: "테스트 돌리기" };

describe("하위 에이전트: 규칙", () => {
  const terminal = (patch: Partial<TerminalInfo>): TerminalInfo => ({
    id: "p1",
    tabId: "t1",
    shell: "pwsh",
    name: "PowerShell 1",
    agent: "Claude Code",
    busy: true,
    working: false,
    finished: 0,
    asking: false,
    subAgents: [],
    ...patch,
  });

  it("허락을 묻고 있으면 작업 중이거나 마친 작업이 있어도 허락 대기다 (AC5)", () => {
    expect(agentStatusOf(terminal({ asking: true }), 0)).toBe("asking");
    expect(agentStatusOf(terminal({ asking: true, working: true, finished: 2 }), 0)).toBe("asking");
    expect(agentStatusOf(terminal({ asking: true, agent: "" }), 0)).toBeNull();
  });

  it("하위 에이전트 줄에는 맡긴 일의 설명이 크게, 종류가 작게 보인다. 설명을 모르면 종류만 보인다 (AC2)", () => {
    expect(subAgentTitle(explore)).toBe("로그인 코드 찾기");
    expect(subAgentKind(explore)).toBe("Explore");
    expect(subAgentTitle({ id: "a", type: "Plan", description: "" })).toBe("Plan");
    expect(subAgentKind({ id: "a", type: "Plan", description: "" })).toBeNull();
    expect(subAgentTitle({ id: "a", type: "", description: "" })).toBe("하위 에이전트");
  });

  it("코어가 보낸 소식에서 하위 에이전트와 허락 대기를 읽고, 모양이 다르면 받지 않는다", () => {
    const base = { id: "p1", tabId: "t1", shell: "pwsh", name: "PowerShell 1", agent: "Claude Code", busy: true, working: true, finished: 0 };
    const events = (extra: object) => parseTerminalEvents({ version: 1, quitRequests: 0, output: [], terminals: [{ ...base, ...extra }] });
    expect(events({ asking: true, subAgents: [explore] })?.terminals[0]).toMatchObject({ asking: true, subAgents: [explore] });
    expect(events({ asking: false })).toBeUndefined();
    expect(events({ asking: false, subAgents: [{ id: "a1" }] })).toBeUndefined();
  });
});

describe("하위 에이전트: 에이전트 칸", () => {
  it("에이전트가 하위 에이전트를 부리면 그 터미널 줄 아래에 한 줄씩 생기고, 끝나면 사라진다 (AC1, AC3)", async () => {
    const { user, terminals } = await openProject();
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    const [first] = terminals.list();
    terminals.setAgent(first!.id, "Claude Code");
    await waitFor(() => expect(statuses()).toEqual(["입력 대기", null]));
    expect(subRows()).toEqual([[], []]);

    terminals.setSubAgents(first!.id, [explore]);
    await waitFor(() => expect(subRows()).toEqual([["로그인 코드 찾기Explore"], []]));
    // 하위 에이전트가 도는 동안 그 에이전트는 작업 중이다
    expect(statuses()).toEqual(["작업 중", null]);

    terminals.setSubAgents(first!.id, [explore, tests]);
    await waitFor(() => expect(subRows()[0]).toEqual(["로그인 코드 찾기Explore", "테스트 돌리기general-purpose"]));

    terminals.setSubAgents(first!.id, [tests]);
    await waitFor(() => expect(subRows()[0]).toEqual(["테스트 돌리기general-purpose"]));
    terminals.setSubAgents(first!.id, []);
    await waitFor(() => expect(subRows()).toEqual([[], []]));
    expect(agentPane().querySelector(".subagents")).toBeNull();
  });

  it("하위 에이전트 줄은 읽어 주는 프로그램에 그 터미널의 하위 에이전트 목록으로 전달되고, 터미널 줄의 이름은 바뀌지 않는다 (AC7)", async () => {
    const { terminals } = await openProject();
    const [first] = terminals.list();
    terminals.setAgent(first!.id, "Claude Code");
    terminals.setSubAgents(first!.id, [explore, { id: "a3", type: "Plan", description: "" }]);

    const list = await within(agentPane()).findByRole("list", { name: "PowerShell 1의 하위 에이전트" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["로그인 코드 찾기Explore", "Plan"]);
    // 잘려 보일 때를 위해 설명 전체가 말풍선으로 보인다
    expect(items[0]).toHaveAttribute("title", "로그인 코드 찾기");
    expect(within(agentPane()).getByRole("button", { name: "PowerShell 1, Claude Code 실행 중" })).toBeInTheDocument();
  });

  it("에이전트가 끝나면 하위 에이전트 줄도 사라진다 (AC8)", async () => {
    const { terminals } = await openProject();
    const [first] = terminals.list();
    terminals.setAgent(first!.id, "Claude Code");
    terminals.setSubAgents(first!.id, [explore]);
    await waitFor(() => expect(subRows()).toEqual([["로그인 코드 찾기Explore"]]));
    terminals.setAgent(first!.id, "");
    await waitFor(() => expect(subRows()).toEqual([[]]));
    expect(statuses()).toEqual([null]);
  });
});

describe("허락 대기", () => {
  it("에이전트가 허락을 물으면 그 줄이 허락 대기가 되고, 답하면 풀린다 (AC5)", async () => {
    const { terminals } = await openProject();
    const [first] = terminals.list();
    terminals.setAgent(first!.id, "Claude Code");
    terminals.setWorking(first!.id, true);
    await waitFor(() => expect(statuses()).toEqual(["작업 중"]));

    terminals.setAsking(first!.id, true);
    await waitFor(() => expect(statuses()).toEqual(["허락 대기"]));
    expect(rows()[0]!.querySelector(".agentrow__dot")).toHaveClass("agentrow__dot--asking");
    expect(within(agentPane()).getByRole("button", { name: "PowerShell 1, Claude Code 실행 중" })).toHaveAccessibleDescription("허락 대기");
    // 보고 있는 터미널이면 프로젝트 탭에 점을 찍지 않는다
    expect(attention("alpha")).toBeNull();

    terminals.setAsking(first!.id, false);
    await waitFor(() => expect(statuses()).toEqual(["작업 중"]));
  });

  it("보고 있지 않은 터미널이나 다른 프로젝트 탭의 에이전트가 허락을 기다리면 그 프로젝트 탭에 점이 표시된다 (AC5)", async () => {
    const { user, terminals } = await openProject([ALPHA, BETA]);
    await user.click(projectTab("alpha"));
    await waitFor(() => expect(terminals.list()).toHaveLength(2));
    const alpha = terminals.list().find((terminal) => terminal.tabId !== terminals.list()[1]!.tabId) ?? terminals.list()[0]!;
    const inAlpha = terminals.list().filter((terminal) => terminal.tabId === alpha.tabId)[0]!;
    terminals.setAgent(inAlpha.id, "Claude Code");
    await waitFor(() => expect(statuses()).toEqual(["입력 대기"]));

    await user.click(projectTab("beta"));
    await waitFor(() => expect(statuses()).toEqual([null]));
    terminals.setAsking(inAlpha.id, true);
    await waitFor(() => expect(attention("alpha")).not.toBeNull());
    expect(projectTab("alpha")).toHaveAccessibleDescription("허락을 기다리는 에이전트가 있습니다");
    expect(attention("beta")).toBeNull();

    // 그 탭으로 가서 그 터미널을 보면 점은 사라지고, 줄은 답할 때까지 허락 대기다
    await user.click(projectTab("alpha"));
    await waitFor(() => expect(statuses()).toEqual(["허락 대기"]));
    expect(attention("alpha")).toBeNull();
  });
});
