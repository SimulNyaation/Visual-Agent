import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeCore } from "../../test/fakeCore";
import { fakeScreens } from "../../test/fakeScreen";
import { createFileTreeStore } from "../fileTree/fileTreeStore";
import { ProjectWorkspace } from "../projectTabs/ProjectWorkspace";
import { createProjectTabsStore } from "../projectTabs/projectTabsStore";
import { createTerminalStore } from "./terminalStore";

const ALPHA = "C:\\work\\alpha";
const BETA = "C:\\work\\beta";
const GONE = "C:\\work\\gone";

async function openProject(options: { picks?: string[]; missing?: string[]; shell?: "pwsh" | "cmd" | null } = {}) {
  const picks = options.picks ?? [ALPHA];
  const core = fakeCore({ picks, missing: options.missing, shell: options.shell });
  const screens = fakeScreens();
  const store = createProjectTabsStore(core.api);
  const fileStore = createFileTreeStore(core.api, store);
  const terminalStore = createTerminalStore(core.api, store, screens.create);
  await store.load();
  render(<ProjectWorkspace store={store} fileStore={fileStore} terminalStore={terminalStore} captionWidth={138} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "폴더 선택" }));
  for (let extra = 1; extra < picks.length; extra++) {
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));
  }
  return { user, core, screens, terminals: core.terminals };
}

const agentPane = () => screen.getByRole("region", { name: "에이전트 칸" });
const workArea = () => screen.getByRole("region", { name: "작업 영역" });
/** 에이전트 칸의 터미널 줄들을 읽어 주는 이름 */
const rowNames = () =>
  within(agentPane())
    .queryAllByRole("listitem")
    .map((item) => item.querySelector(".agentrow__select")?.getAttribute("aria-label"));
const row = (name: string) => within(agentPane()).getByRole("button", { name });
const selectedRow = () => agentPane().querySelector('[aria-current="true"]')?.getAttribute("aria-label");
const shown = () => workArea().querySelector(".fake-screen")?.textContent;
const waitForRows = (names: string[]) => waitFor(() => expect(rowNames()).toEqual(names));
const dialog = () => screen.getByRole("alertdialog", { name: "닫기 확인" });
const noDialog = () => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

describe("터미널이 뜬다", () => {
  it("프로젝트 탭을 열면 터미널 하나가 자동으로 뜨고, 에이전트 칸에 한 줄이 표시된다 (AC1, AC3, AC14)", async () => {
    const { terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    expect(terminals.list()).toMatchObject([{ shell: "pwsh", name: "PowerShell 1" }]);
    expect(within(workArea()).getByRole("group", { name: "터미널" })).toBeInTheDocument();
    expect(selectedRow()).toBe("PowerShell 1");
  });

  it("PowerShell 7이 뜨지 않는 컴퓨터에서는 명령 프롬프트가 뜬다 (AC3)", async () => {
    await openProject({ shell: "cmd" });
    await waitForRows(["cmd 1"]);
  });

  it("셸을 고르는 버튼과 목록은 없다. 새 터미널(+)만 있다 (AC24)", async () => {
    await openProject();
    await waitForRows(["PowerShell 1"]);
    expect(screen.getByRole("button", { name: "새 터미널" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "셸 고르기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("폴더를 찾을 수 없는 탭에서는 터미널이 뜨지 않고 없어진 폴더 안내가 표시된다 (AC4)", async () => {
    const { terminals } = await openProject({ picks: [GONE], missing: [GONE] });
    expect(workArea()).toHaveTextContent("폴더를 찾을 수 없습니다");
    expect(terminals.list()).toEqual([]);
    expect(within(agentPane()).getByText("터미널이 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "새 터미널" })).not.toBeInTheDocument();
  });

  it("터미널을 띄우지 못하면 작업 영역에 이유가 표시된다 (AC27)", async () => {
    await openProject({ shell: null });
    expect(await within(workArea()).findByRole("alert")).toHaveTextContent(
      "터미널을 띄우지 못했습니다: 이 컴퓨터에서 쓸 수 있는 셸을 찾지 못했습니다",
    );
    expect(workArea()).toHaveTextContent("터미널이 없습니다");
  });

  it("셸을 시작하지 못하면 이유가 표시되고, 다시 띄워 성공하면 이유가 사라진다 (AC27)", async () => {
    const core = fakeCore({ picks: [ALPHA] });
    core.terminals.failNextOpen("start_failed");
    const store = createProjectTabsStore(core.api);
    const terminalStore = createTerminalStore(core.api, store, fakeScreens().create);
    await store.load();
    render(
      <ProjectWorkspace
        store={store}
        fileStore={createFileTreeStore(core.api, store)}
        terminalStore={terminalStore}
        captionWidth={138}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    expect(await within(workArea()).findByRole("alert")).toHaveTextContent("셸을 시작하지 못했습니다");

    await user.click(within(workArea()).getByRole("button", { name: "새 터미널" }));
    await waitForRows(["PowerShell 1"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("터미널을 쓴다", () => {
  it("터미널의 출력이 작업 영역에 표시된다. 글자 중간에서 끊겨 와도 깨지지 않는다 (AC5, AC6)", async () => {
    const { terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    const id = terminals.list()[0]!.id;

    terminals.emit(id, "PS C:\\work\\alpha> ");
    await waitFor(() => expect(shown()).toBe("PS C:\\work\\alpha> "));

    // "한글"을 바이트 중간에서 둘로 나눠 보낸다
    const bytes = new TextEncoder().encode("한글");
    terminals.emitBytes(id, bytes.slice(0, 4));
    await waitFor(() => expect(shown()).toBe("PS C:\\work\\alpha> 한"));
    terminals.emitBytes(id, bytes.slice(4));
    await waitFor(() => expect(shown()).toBe("PS C:\\work\\alpha> 한글"));
  });

  it("터미널에 넣은 글자가 코어에 전달된다 (AC5)", async () => {
    const { screens, terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    const id = terminals.list()[0]!.id;

    screens.all[0]!.type("d");
    screens.all[0]!.type("i");
    screens.all[0]!.type("r\r");
    await waitFor(() => expect(terminals.inputs(id).join("")).toBe("dir\r"));
  });

  it("앞의 글자가 아직 전달되는 중이면 다음 글자는 기다렸다가 순서대로 간다", async () => {
    const { screens, terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    const id = terminals.list()[0]!.id;

    const release = terminals.holdInput();
    for (const key of ["g", "i", "t", " ", "s", "t", "a", "t", "u", "s"]) screens.all[0]!.type(key);
    expect(terminals.inputs(id)).toEqual([]);
    release();

    // 첫 글자가 먼저 가고, 그동안 쌓인 나머지는 한 번에 순서대로 간다
    await waitFor(() => expect(terminals.inputs(id)).toEqual(["g", "it status"]));
  });

  it("화면 크기에 맞춰 글자 수가 바뀌면 코어에 알린다 (AC8)", async () => {
    const { screens, terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    screens.all[0]!.resize(96, 41);
    await waitFor(() => expect(terminals.sizes(terminals.list()[0]!.id)).toEqual(["96x41"]));
  });
});

describe("여러 터미널과 에이전트 칸", () => {
  it("새 터미널(+)을 누르면 터미널이 하나 더 뜨고, 줄이 늘고, 작업 영역이 새 터미널로 바뀐다 (AC15)", async () => {
    const { user, terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    terminals.emit(terminals.list()[0]!.id, "first");
    await waitFor(() => expect(shown()).toBe("first"));

    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitForRows(["PowerShell 1", "PowerShell 2"]);
    expect(selectedRow()).toBe("PowerShell 2");
    expect(shown()).toBe("");
  });

  it("줄을 누르면 작업 영역이 그 터미널로 바뀌고, 가려져 있던 동안 나온 출력도 보인다 (AC16)", async () => {
    const { user, terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitForRows(["PowerShell 1", "PowerShell 2"]);
    const [first, second] = terminals.list();

    terminals.emit(first!.id, "가려진 동안 ");
    terminals.emit(second!.id, "second");
    terminals.emit(first!.id, "나온 출력");
    await waitFor(() => expect(shown()).toBe("second"));

    await user.click(row("PowerShell 1"));
    expect(selectedRow()).toBe("PowerShell 1");
    expect(shown()).toBe("가려진 동안 나온 출력");

    await user.click(row("PowerShell 2"));
    expect(shown()).toBe("second");
  });

  it("줄의 닫기(×)를 누르면 그 터미널이 닫히고 줄이 사라진다 (AC17)", async () => {
    const { user, screens } = await openProject();
    await waitForRows(["PowerShell 1"]);
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitForRows(["PowerShell 1", "PowerShell 2"]);

    await user.click(screen.getByRole("button", { name: "PowerShell 2 닫기" }));
    await waitForRows(["PowerShell 1"]);
    noDialog();
    // 남은 터미널이 작업 영역에 보인다
    expect(selectedRow()).toBe("PowerShell 1");
    expect(screens.all[1]!.disposed).toBe(true);
    expect(screens.all[0]!.disposed).toBe(false);
  });

  it("실행 중인 프로그램이 있는 터미널을 닫으려 하면 확인 창이 먼저 뜬다 (AC17)", async () => {
    const { user, terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    terminals.setBusy(terminals.list()[0]!.id, true);

    await user.click(screen.getByRole("button", { name: "PowerShell 1 닫기" }));
    expect(dialog()).toHaveTextContent("실행 중인 프로그램이 있습니다. 닫으면 종료됩니다");

    await user.click(within(dialog()).getByRole("button", { name: "취소" }));
    noDialog();
    expect(rowNames()).toEqual(["PowerShell 1"]);

    await user.click(screen.getByRole("button", { name: "PowerShell 1 닫기" }));
    await user.click(within(dialog()).getByRole("button", { name: "닫기" }));
    await waitForRows([]);
    noDialog();
  });

  it("확인 창에서 Esc를 누르면 닫히지 않는다 (AC17)", async () => {
    const { user, terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    terminals.setBusy(terminals.list()[0]!.id, true);
    await user.click(screen.getByRole("button", { name: "PowerShell 1 닫기" }));
    dialog();
    await user.keyboard("{Escape}");
    noDialog();
    expect(terminals.list()).toHaveLength(1);
  });

  it("셸이 끝나면(exit) 그 터미널의 줄이 사라진다 (AC18)", async () => {
    const { terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    terminals.exit(terminals.list()[0]!.id);
    await waitForRows([]);
  });

  it("터미널이 하나도 없으면 안내와 새 터미널 버튼이 표시되고, 저절로 다시 뜨지 않는다 (AC19, AS6)", async () => {
    const { user, terminals } = await openProject({ picks: [ALPHA, BETA] });
    await waitForRows(["PowerShell 1"]);
    await user.click(screen.getByRole("tab", { name: "alpha" }));
    await waitForRows(["PowerShell 1"]);
    await user.click(screen.getByRole("button", { name: "PowerShell 1 닫기" }));

    await waitFor(() => expect(workArea()).toHaveTextContent("터미널이 없습니다"));
    expect(within(agentPane()).getByText("터미널이 없습니다")).toBeInTheDocument();

    // 다른 탭에 갔다 와도 다시 뜨지 않는다
    await user.click(screen.getByRole("tab", { name: "beta" }));
    await user.click(screen.getByRole("tab", { name: "alpha" }));
    expect(workArea()).toHaveTextContent("터미널이 없습니다");
    expect(terminals.list().filter((terminal) => terminal.tabId === "t1")).toEqual([]);

    await user.click(within(workArea()).getByRole("button", { name: "새 터미널" }));
    await waitForRows(["PowerShell 1"]);
  });

  it("프로젝트 탭을 바꾸면 에이전트 칸과 작업 영역이 그 프로젝트의 터미널로 바뀌고, 돌아오면 내용이 그대로다 (AC20)", async () => {
    const { user, terminals } = await openProject({ picks: [ALPHA, BETA] });
    await user.click(screen.getByRole("tab", { name: "alpha" }));
    await waitForRows(["PowerShell 1"]);
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitForRows(["PowerShell 1", "PowerShell 2"]);
    const alpha = terminals.list().filter((terminal) => terminal.tabId === "t1");
    const beta = terminals.list().filter((terminal) => terminal.tabId === "t2");
    expect(beta).toHaveLength(1);
    terminals.emit(alpha[1]!.id, "alpha 두 번째");
    await waitFor(() => expect(shown()).toBe("alpha 두 번째"));

    await user.click(screen.getByRole("tab", { name: "beta" }));
    await waitForRows(["PowerShell 1"]);
    expect(shown()).toBe("");
    // 보이지 않는 탭의 터미널도 계속 출력을 받는다
    terminals.emit(alpha[1]!.id, " + 다른 탭을 보는 동안");
    terminals.emit(beta[0]!.id, "beta");
    await waitFor(() => expect(shown()).toBe("beta"));

    await user.click(screen.getByRole("tab", { name: "alpha" }));
    await waitForRows(["PowerShell 1", "PowerShell 2"]);
    expect(selectedRow()).toBe("PowerShell 2");
    expect(shown()).toBe("alpha 두 번째 + 다른 탭을 보는 동안");
  });
});

describe("터미널마다 에이전트가 보인다", () => {
  it("에이전트를 실행하면 그 줄에 이름과 실행 중 표시가 나타나고, 끝내면 사라진다 (AC21, AC22)", async () => {
    const { terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    const id = terminals.list()[0]!.id;
    expect(agentPane().querySelector(".agentrow__dot--running")).toBeNull();

    terminals.setAgent(id, "Claude Code");
    await waitForRows(["PowerShell 1, Claude Code 실행 중"]);
    expect(within(agentPane()).getByText("Claude Code")).toBeInTheDocument();
    expect(agentPane().querySelector(".agentrow__dot--running")).not.toBeNull();

    terminals.setAgent(id, "");
    await waitForRows(["PowerShell 1"]);
    expect(within(agentPane()).queryByText("Claude Code")).not.toBeInTheDocument();
    expect(agentPane().querySelector(".agentrow__dot--running")).toBeNull();
  });

  it("터미널마다 제 에이전트가 표시되고, 실행하지 않은 터미널에는 표시가 없다 (AC23)", async () => {
    const { user, terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitForRows(["PowerShell 1", "PowerShell 2", "PowerShell 3"]);
    const [first, , third] = terminals.list();

    terminals.setAgent(first!.id, "Claude Code");
    terminals.setAgent(third!.id, "Codex");
    await waitForRows(["PowerShell 1, Claude Code 실행 중", "PowerShell 2", "PowerShell 3, Codex 실행 중"]);
    expect(agentPane().querySelectorAll(".agentrow__dot--running")).toHaveLength(2);
  });
});

describe("닫기와 안전", () => {
  it("실행 중인 프로그램이 있는 프로젝트 탭을 닫으려 하면 확인 창이 뜨고, 취소하면 닫히지 않는다 (AC28)", async () => {
    const { user, terminals } = await openProject({ picks: [ALPHA, BETA] });
    await waitForRows(["PowerShell 1"]);
    const beta = terminals.list().find((terminal) => terminal.tabId === "t2")!;
    terminals.setAgent(beta.id, "Claude Code");
    await waitForRows(["PowerShell 1, Claude Code 실행 중"]);

    await user.click(screen.getByRole("button", { name: "beta 탭 닫기" }));
    expect(dialog()).toHaveTextContent("실행 중인 프로그램이 있습니다. 닫으면 종료됩니다");
    await user.click(within(dialog()).getByRole("button", { name: "취소" }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["alpha", "beta"]);
    expect(terminals.list()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "beta 탭 닫기" }));
    await user.click(within(dialog()).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["alpha"]));
    expect(terminals.list().map((terminal) => terminal.tabId)).toEqual(["t1"]);
  });

  it("실행 중인 프로그램이 없는 프로젝트 탭은 묻지 않고 닫힌다 (AS14)", async () => {
    const { user } = await openProject({ picks: [ALPHA, BETA] });
    await waitForRows(["PowerShell 1"]);
    await user.click(screen.getByRole("button", { name: "beta 탭 닫기" }));
    noDialog();
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
  });

  it("앱을 닫으려 할 때 코어가 확인을 요청하면 확인 창이 뜨고, 답이 코어에 전달된다 (AC28)", async () => {
    const { user, terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    noDialog();

    terminals.requestQuit();
    await waitFor(() => dialog());
    await user.click(within(dialog()).getByRole("button", { name: "취소" }));
    noDialog();
    await waitFor(() => expect(terminals.quitAnswers).toEqual([false]));

    terminals.requestQuit();
    await waitFor(() => dialog());
    await user.click(within(dialog()).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(terminals.quitAnswers).toEqual([false, true]));
  });

  it("터미널 소식을 받지 못하게 되면 코어와 연결이 끊겼다고 알린다", async () => {
    const { terminals } = await openProject();
    await waitForRows(["PowerShell 1"]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    terminals.disconnect();
    expect(await screen.findByRole("status")).toHaveTextContent("코어와 연결이 끊겼습니다");
  });
});
