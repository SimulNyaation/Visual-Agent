import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { emptyNaming, followInput, questionFromLine, topicFromTitle } from "../../domain/terminalNames";
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
  return { user, screens, terminals: core.terminals };
}

const agentPane = () => screen.getByRole("region", { name: "에이전트 칸" });
const rows = () => within(agentPane()).queryAllByRole("listitem");
/** 줄에 보이는 글자 (닫기 버튼 제외) */
const rowTexts = () => rows().map((item) => item.querySelector(".agentrow__select")?.textContent);
const rowLabels = () => rows().map((item) => item.querySelector(".agentrow__select")?.getAttribute("aria-label"));
const waitForTexts = (texts: string[]) => waitFor(() => expect(rowTexts()).toEqual(texts));

/** 터미널 하나를 띄우고 그 안에서 Claude Code를 실행한 상태 */
async function withAgent(picks: string[] = [ALPHA]) {
  const opened = await openProject(picks);
  const id = opened.terminals.list().find((terminal) => terminal.tabId === `t${picks.length}`)!.id;
  const view = opened.screens.all[opened.screens.all.length - 1]!;
  act(() => view.type("claude\r"));
  opened.terminals.setAgent(id, "Claude Code");
  await waitForTexts(["Claude CodePowerShell 1"]);
  return { ...opened, id, view };
}

describe("터미널 이름: 규칙", () => {
  const context = { agent: "Claude Code", folder: "alpha" };

  it("에이전트가 알려 준 제목에서 앞의 장식 기호를 빼고 주제를 얻는다 (AC3, AS7)", () => {
    expect(topicFromTitle("✳ 로그인 오류 수정", context)).toBe("로그인 오류 수정");
    expect(topicFromTitle("⠐ Fix login error", context)).toBe("Fix login error");
    expect(topicFromTitle("  README 번역  ", context)).toBe("README 번역");
  });

  it("에이전트의 이름, 실행 명령, 프로젝트 폴더 이름, 파일 경로, 빈 제목은 주제가 아니다 (AC4)", () => {
    for (const title of ["", "   ", "✳", "claude", "✳ Claude Code", "CLAUDE", "codex", "alpha", "Alpha"]) {
      expect(topicFromTitle(title, context), title).toBeNull();
    }
    for (const title of ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "C:/work/alpha", "~/work/alpha", "/home/me", ".\\claude.exe", "pwsh.exe"]) {
      expect(topicFromTitle(title, context), title).toBeNull();
    }
    expect(topicFromTitle("Gemini CLI", { agent: "Gemini CLI", folder: "x" })).toBeNull();
  });

  it("질문의 줄바꿈과 앞뒤 빈칸은 빠지고, /로 시작하는 명령과 빈 입력은 질문이 아니다 (AC9)", () => {
    expect(questionFromLine("  로그인이  안 돼요\n고쳐 줘  ")).toBe("로그인이 안 돼요 고쳐 줘");
    expect(questionFromLine("/help")).toBeNull();
    expect(questionFromLine("  /clear ")).toBeNull();
    expect(questionFromLine("")).toBeNull();
    expect(questionFromLine("   ")).toBeNull();
    expect(questionFromLine("y")).toBeNull();
  });

  const sentBy = (...chunks: string[]) => {
    let naming = emptyNaming;
    const all: string[] = [];
    for (const chunk of chunks) {
      const result = followInput(naming, chunk);
      naming = result.naming;
      all.push(...result.sent);
    }
    return all;
  };

  it("넣은 글자를 따라가 Enter로 보낸 글을 알아낸다. 지운 글자는 빠진다 (AS3)", () => {
    expect(sentBy("h", "e", "l", "l", "o", "\r")).toEqual(["hello"]);
    expect(sentBy("helo", "\x7f", "lo 한글", "\x7f", "\r")).toEqual(["hello 한"]);
    expect(sentBy("abc", "\x15", "def\r")).toEqual(["def"]);
    expect(sentBy("abc", "\x03", "\r")).toEqual([""]);
  });

  it("화살표 같은 조작 키는 글자로 치지 않는다. 메뉴에서 누른 Enter는 빈 입력이다 (AS3)", () => {
    expect(sentBy("\x1b[B", "\x1b[B", "\r")).toEqual([""]);
    expect(sentBy("ab", "\x1b[D", "\x1bOQ", "\x1b[1;5C", "c\r")).toEqual(["abc"]);
    expect(sentBy("\x1b", "hi\r")).toEqual(["hi"]);
  });

  it("붙여넣은 글도 질문에 포함되고, 그 안의 줄바꿈으로는 보내지지 않는다 (AS3)", () => {
    expect(sentBy("봐 줘: ", "\x1b[200~첫 줄\r\n둘째 줄\x1b[201~", "\r")).toEqual(["봐 줘: 첫 줄 둘째 줄"]);
    expect(sentBy("\x1b[200~앞", "뒤\x1b[201~\r")).toEqual(["앞뒤"]);
  });

  it("줄바꿈을 넣는 키(\\ 뒤 Enter, Alt+Enter)는 보내기가 아니다", () => {
    expect(sentBy("첫 줄\\", "\r", "둘째 줄", "\x1b\r", "셋째 줄\r")).toEqual(["첫 줄 둘째 줄 셋째 줄"]);
  });
});

describe("터미널 이름: 에이전트 칸", () => {
  it("에이전트를 실행하지 않은 동안에는 셸에 넣는 명령이나 터미널 제목으로 이름이 바뀌지 않는다 (AC1)", async () => {
    const { screens } = await openProject();
    const view = screens.all[0]!;
    act(() => {
      view.type("git status\r");
      view.title("로그인 오류 수정");
      view.type("dir\r");
    });
    expect(rowTexts()).toEqual(["PowerShell 1"]);
    expect(rowLabels()).toEqual(["PowerShell 1"]);
  });

  it("에이전트를 실행하려고 넣은 명령은 이름이 되지 않는다 (AC1)", async () => {
    await withAgent();
    expect(rowTexts()).toEqual(["Claude CodePowerShell 1"]);
  });

  it("에이전트에게 보낸 첫 질문이 줄 이름이 되고, 에이전트와 터미널 이름이 함께 보인다 (AC2, AC5)", async () => {
    const { view } = await withAgent();
    act(() => view.type("로그인이 안 되는 문제를 고쳐 줘"));
    expect(rowTexts()).toEqual(["Claude CodePowerShell 1"]);
    act(() => view.type("\r"));
    await waitForTexts(["로그인이 안 되는 문제를 고쳐 줘Claude Code · PowerShell 1"]);
    expect(agentPane().querySelector(".agentrow__title")).toHaveTextContent("로그인이 안 되는 문제를 고쳐 줘");
    expect(agentPane().querySelector(".agentrow__meta")).toHaveTextContent("Claude Code · PowerShell 1");
    expect(agentPane().querySelector(".agentrow__dot--running")).not.toBeNull();
  });

  it("이름은 첫 질문으로 정해지고, 다음 질문으로는 바뀌지 않는다 (AC2)", async () => {
    const { view } = await withAgent();
    act(() => view.type("첫 질문\r"));
    act(() => view.type("둘째 질문\r"));
    await waitForTexts(["첫 질문Claude Code · PowerShell 1"]);
  });

  it("에이전트 명령과 빈 입력, 메뉴에서 누른 Enter는 건너뛰고 그다음 질문이 이름이 된다 (AC9)", async () => {
    const { view } = await withAgent();
    act(() => {
      view.type("\r");
      view.type("/help\r");
      view.type("\x1b[B\r");
    });
    expect(rowTexts()).toEqual(["Claude CodePowerShell 1"]);
    act(() => view.type("  README를\\\r번역해 줘  \r"));
    await waitForTexts(["README를 번역해 줘Claude Code · PowerShell 1"]);
  });

  it("에이전트가 주제를 알려 주면 첫 질문 대신 주제가 이름이 되고, 주제가 바뀌면 따라 바뀐다 (AC3, AS6)", async () => {
    const { view } = await withAgent();
    act(() => view.type("로그인이 안 돼\r"));
    await waitForTexts(["로그인이 안 돼Claude Code · PowerShell 1"]);

    act(() => view.title("✳ 로그인 오류 수정"));
    await waitForTexts(["로그인 오류 수정Claude Code · PowerShell 1"]);
    act(() => view.title("⠐ 로그인 오류 수정"));
    expect(rowTexts()).toEqual(["로그인 오류 수정Claude Code · PowerShell 1"]);

    act(() => view.title("✳ 세션 만료 처리"));
    await waitForTexts(["세션 만료 처리Claude Code · PowerShell 1"]);
  });

  it("주제가 아닌 제목은 이름으로 쓰지 않는다. 주제가 정해진 뒤에는 첫 질문으로 돌아가지 않는다 (AC4, AS6)", async () => {
    const { view } = await withAgent();
    act(() => {
      view.title("claude");
      view.title("alpha");
      view.title("C:\\work\\alpha");
      view.title("");
    });
    expect(rowTexts()).toEqual(["Claude CodePowerShell 1"]);

    act(() => view.type("질문입니다\r"));
    act(() => view.title("✳ 주제입니다"));
    act(() => view.title("✳ Claude Code"));
    await waitForTexts(["주제입니다Claude Code · PowerShell 1"]);
  });

  it("에이전트를 실행하기 전에 셸이 보낸 제목은 에이전트가 실행된 뒤에도 이름이 되지 않는다 (AC1)", async () => {
    const { screens, terminals } = await openProject();
    const view = screens.all[0]!;
    act(() => {
      view.type("title My Window\r");
      view.title("My Window");
      view.type("claude\r");
      view.title("My Window - claude");
    });
    terminals.setAgent(terminals.list()[0]!.id, "Claude Code");
    await waitForTexts(["Claude CodePowerShell 1"]);
  });

  it("이름이 길어도 한 줄로 두고, 마우스를 올리면 전체가 보이게 한다 (AC6)", async () => {
    const { view } = await withAgent();
    const long = "아주 긴 질문입니다 ".repeat(12).trim();
    act(() => view.type(`${long}\r`));
    await waitFor(() => expect(agentPane().querySelector(".agentrow__title")).toHaveTextContent(long));
    expect(agentPane().querySelector(".agentrow__select")).toHaveAttribute("title", long);
  });

  it("에이전트를 끝내면 원래 이름으로 돌아가고, 다시 실행하면 이름이 새로 정해진다 (AC7)", async () => {
    const { view, id, terminals } = await withAgent();
    act(() => view.type("첫 대화\r"));
    act(() => view.title("✳ 첫 주제"));
    await waitForTexts(["첫 주제Claude Code · PowerShell 1"]);

    terminals.setAgent(id, "");
    await waitForTexts(["PowerShell 1"]);
    act(() => view.title("C:\\Program Files\\PowerShell\\7\\pwsh.exe"));

    act(() => view.type("claude\r"));
    terminals.setAgent(id, "Claude Code");
    await waitForTexts(["Claude CodePowerShell 1"]);
    act(() => view.type("둘째 대화\r"));
    await waitForTexts(["둘째 대화Claude Code · PowerShell 1"]);
  });

  it("터미널마다 제 이름을 갖고, 보고 있지 않은 터미널의 이름도 정해진다 (AC8)", async () => {
    const { user, view, terminals } = await withAgent();
    act(() => view.type("첫째 터미널의 질문\r"));
    await user.click(screen.getByRole("button", { name: "새 터미널" }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rowTexts()).toEqual(["첫째 터미널의 질문Claude Code · PowerShell 1", "PowerShell 2"]);

    // 둘째 터미널을 보는 동안 첫째 터미널의 에이전트가 주제를 알려 준다
    act(() => view.title("✳ 첫째의 주제"));
    await waitForTexts(["첫째의 주제Claude Code · PowerShell 1", "PowerShell 2"]);
    expect(terminals.list()).toHaveLength(2);
  });

  it("다른 프로젝트 탭을 보고 있는 동안 정해진 이름도 돌아오면 표시되어 있다 (AC8)", async () => {
    const { user, view } = await withAgent([ALPHA, BETA]);
    act(() => view.type("베타에서 한 질문\r"));
    await waitForTexts(["베타에서 한 질문Claude Code · PowerShell 1"]);

    await user.click(screen.getByRole("tab", { name: "alpha" }));
    await waitForTexts(["PowerShell 1"]);
    act(() => view.title("✳ 베타의 주제"));

    await user.click(screen.getByRole("tab", { name: "beta" }));
    await waitForTexts(["베타의 주제Claude Code · PowerShell 1"]);
  });

  it("닫기 버튼과 읽어 주는 이름은 계속 터미널의 원래 이름으로 가리킨다 (AC10)", async () => {
    const { view } = await withAgent();
    act(() => view.type("질문입니다\r"));
    await waitForTexts(["질문입니다Claude Code · PowerShell 1"]);
    expect(rowLabels()).toEqual(["PowerShell 1, Claude Code 실행 중"]);
    expect(within(agentPane()).getByRole("button", { name: "PowerShell 1 닫기" })).toBeInTheDocument();
  });
});
