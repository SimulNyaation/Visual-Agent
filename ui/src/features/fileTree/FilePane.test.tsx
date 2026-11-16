import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeCore, type FakeCore } from "../../test/fakeCore";
import { ProjectWorkspace } from "../projectTabs/ProjectWorkspace";
import { createProjectTabsStore } from "../projectTabs/projectTabsStore";
import { createFileTreeStore } from "./fileTreeStore";

const ALPHA = "C:\\work\\alpha";
const BETA = "C:\\work\\beta";
const alphaFiles = ["docs/guide.md", "src/main.ts", "src/util/text.ts", "assets/", "readme.md", "notes.txt", "Zeta.txt"];

async function openProject(options: { files?: string[]; picks?: string[]; missing?: string[] } = {}) {
  const picks = options.picks ?? [ALPHA];
  const core = fakeCore({
    picks,
    missing: options.missing,
    files: { [ALPHA]: options.files ?? alphaFiles, [BETA]: ["b.txt", "lib/x.ts"] },
  });
  const store = createProjectTabsStore(core.api);
  const fileStore = createFileTreeStore(core.api, store);
  await store.load();
  render(<ProjectWorkspace store={store} fileStore={fileStore} captionWidth={138} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "폴더 선택" }));
  for (let extra = 1; extra < picks.length; extra++) {
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));
  }
  return { user, core };
}

const tree = () => screen.getByRole("tree", { name: "파일" });
const row = (name: string) => within(tree()).getByRole("treeitem", { name });
const findRow = (name: string) => within(tree()).findByRole("treeitem", { name });
const rowNames = () => within(tree()).queryAllByRole("treeitem").map((item) => item.getAttribute("aria-label"));
const selectedNames = () =>
  within(tree())
    .queryAllByRole("treeitem", { selected: true })
    .map((item) => item.getAttribute("aria-label"));
const note = () => screen.getByRole("status");
const menuItems = () => screen.queryAllByRole("menuitem").map((item) => item.textContent);

const transfer = () => ({ dataTransfer: { setData: () => undefined, effectAllowed: "none" } });
async function drag(source: HTMLElement, target: HTMLElement) {
  fireEvent.dragStart(source, transfer());
  fireEvent.dragOver(target, transfer());
  fireEvent.drop(target, transfer());
  fireEvent.dragEnd(source, transfer());
}

async function rightClick(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  await user.pointer({ keys: "[MouseRight]", target });
}

async function expectPaths(core: FakeCore, expected: string[]) {
  await waitFor(() => expect(core.paths(ALPHA)).toEqual([...expected].sort()));
}

describe("사이드바의 두 칸", () => {
  it("위는 에이전트 칸, 아래는 파일 칸이고 에이전트 칸에는 에이전트가 없다고 표시된다 (AC1, AC2)", async () => {
    await openProject();
    const panes = screen.getAllByRole("region", { name: / 칸$/ });
    expect(panes.map((pane) => pane.getAttribute("aria-label"))).toEqual(["에이전트 칸", "파일 칸"]);
    expect(within(panes[0]!).getByRole("button", { name: "에이전트" })).toBeInTheDocument();
    expect(within(panes[0]!).getByText("에이전트가 없습니다")).toBeInTheDocument();
    expect(within(panes[1]!).getByRole("button", { name: "파일" })).toBeInTheDocument();
  });

  it("칸 제목을 누르면 그 칸이 접혀 제목만 남고, 다시 누르면 펼쳐진다 (AC5)", async () => {
    const { user } = await openProject();
    await findRow("readme.md");

    await user.click(screen.getByRole("button", { name: "파일" }));
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "파일" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("region", { name: "파일 칸" })).toHaveClass("pane--collapsed");
    expect(screen.getByRole("region", { name: "에이전트 칸" })).not.toHaveClass("pane--collapsed");

    await user.click(screen.getByRole("button", { name: "파일" }));
    expect(await findRow("readme.md")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "에이전트" }));
    expect(screen.queryByText("에이전트가 없습니다")).not.toBeInTheDocument();
  });
});

describe("파일 칸 보기", () => {
  it("폴더가 먼저, 그다음 파일이 이름순으로 나오고 아이콘으로 구분된다 (AC3)", async () => {
    await openProject();
    await findRow("readme.md");
    expect(rowNames()).toEqual(["assets", "docs", "src", "notes.txt", "readme.md", "Zeta.txt"]);
    expect(row("docs")).toHaveAttribute("data-kind", "folder");
    expect(row("readme.md")).toHaveAttribute("data-kind", "file");
    expect(row("docs").querySelector(".filerow__icon--folder")).not.toBeNull();
    expect(row("readme.md").querySelector(".filerow__icon--file")).not.toBeNull();
  });

  it("폴더를 누르면 안의 내용이 한 단계 들여쓰기되어 펼쳐지고, 다시 누르면 접힌다 (AC4)", async () => {
    const { user } = await openProject();
    await user.click(await findRow("src"));

    expect(await findRow("main.ts")).toHaveAttribute("aria-level", "2");
    expect(row("src")).toHaveAttribute("aria-expanded", "true");

    await user.click(row("util"));
    expect(await findRow("text.ts")).toHaveAttribute("aria-level", "3");

    await user.click(row("src"));
    expect(screen.queryByRole("treeitem", { name: "main.ts" })).not.toBeInTheDocument();
    expect(row("src")).toHaveAttribute("aria-expanded", "false");
  });

  it("앱 밖에서 파일이 생기거나 없어지면 펼쳐진 폴더에 반영된다 (AC6)", async () => {
    const { user, core } = await openProject();
    await user.click(await findRow("src"));
    await findRow("main.ts");

    core.external(ALPHA, (files) => {
      files.set("src/added.ts", "file");
      files.delete("readme.md");
    });

    expect(await findRow("added.ts")).toHaveAttribute("aria-level", "2");
    await waitFor(() => expect(rowNames()).not.toContain("readme.md"));
  });

  it("프로젝트 탭을 바꾸면 그 프로젝트의 폴더가 보이고, 돌아오면 펼쳐 둔 폴더가 그대로다 (AC7)", async () => {
    const { user } = await openProject({ picks: [ALPHA, BETA] });
    await findRow("b.txt");
    expect(rowNames()).toEqual(["lib", "b.txt"]);

    await user.click(screen.getByRole("tab", { name: "alpha" }));
    await user.click(await findRow("src"));
    await findRow("main.ts");

    await user.click(screen.getByRole("tab", { name: "beta" }));
    await findRow("b.txt");
    expect(rowNames()).not.toContain("main.ts");

    await user.click(screen.getByRole("tab", { name: "alpha" }));
    expect(await findRow("main.ts")).toBeInTheDocument();
    expect(row("src")).toHaveAttribute("aria-expanded", "true");
  });

  it("줄이 5,000개여도 화면에 보이는 만큼만 그린다 (AC8)", async () => {
    const many = Array.from({ length: 5000 }, (_, index) => `big/file-${String(index).padStart(4, "0")}.txt`);
    const { user } = await openProject({ files: many });
    await user.click(await findRow("big"));
    await findRow("file-0000.txt");

    expect(within(tree()).queryAllByRole("treeitem").length).toBeLessThan(100);
    expect(tree().querySelector(".filetree__rows")).toHaveStyle({ height: `${5001 * 26 + 40}px` });

    fireEvent.scroll(tree(), { target: { scrollTop: 4000 * 26 } });
    expect(await findRow("file-4000.txt")).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "file-0000.txt" })).not.toBeInTheDocument();
  });

  it("폴더를 찾을 수 없는 탭에서는 파일 칸에 그렇게 표시된다 (AC9)", async () => {
    await openProject({ missing: [ALPHA] });
    const pane = screen.getByRole("region", { name: "파일 칸" });
    expect(within(pane).getByText("폴더를 찾을 수 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });
});

describe("선택", () => {
  it("누르면 선택되고, Ctrl로 하나씩 더하고, Shift로 사이를 모두 고른다 (AC10)", async () => {
    const { user } = await openProject();
    await user.click(await findRow("notes.txt"));
    expect(selectedNames()).toEqual(["notes.txt"]);

    await user.keyboard("{Control>}");
    await user.click(row("Zeta.txt"));
    await user.keyboard("{/Control}");
    expect(selectedNames()).toEqual(["notes.txt", "Zeta.txt"]);

    await user.click(row("notes.txt"));
    await user.keyboard("{Shift>}");
    await user.click(row("Zeta.txt"));
    await user.keyboard("{/Shift}");
    expect(selectedNames()).toEqual(["notes.txt", "readme.md", "Zeta.txt"]);
  });

  it("위·아래 화살표로 선택이 움직이고, 오른쪽·왼쪽 화살표로 폴더가 펼쳐지고 접힌다 (AC11)", async () => {
    const { user } = await openProject();
    await user.click(await findRow("notes.txt"));

    await user.keyboard("{ArrowDown}");
    expect(selectedNames()).toEqual(["readme.md"]);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(selectedNames()).toEqual(["src"]);

    await user.keyboard("{ArrowRight}");
    expect(await findRow("main.ts")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(selectedNames()).toEqual(["util"]);

    await user.keyboard("{ArrowUp}{ArrowLeft}");
    await waitFor(() => expect(rowNames()).not.toContain("main.ts"));
  });
});

describe("옮기기", () => {
  it("파일을 끌어 폴더에 놓으면 그 폴더 안으로 옮겨진다 (AC12)", async () => {
    const { core } = await openProject({ files: ["docs/", "readme.md"] });
    await drag(await findRow("readme.md"), row("docs"));

    await expectPaths(core, ["docs/", "docs/readme.md"]);
    expect(await findRow("readme.md")).toHaveAttribute("aria-level", "2");
  });

  it("여러 개를 선택하고 그중 하나를 끌면 모두 함께 옮겨진다 (AC13)", async () => {
    const { user, core } = await openProject({ files: ["docs/", "a.txt", "b.txt", "c.txt"] });
    await user.click(await findRow("a.txt"));
    await user.keyboard("{Control>}");
    await user.click(row("c.txt"));
    await user.keyboard("{/Control}");

    await drag(row("c.txt"), row("docs"));

    await expectPaths(core, ["docs/", "docs/a.txt", "docs/c.txt", "b.txt"]);
  });

  it("끄는 동안 놓을 폴더가 강조되고, 빈 곳에 놓으면 프로젝트 폴더 바로 아래로 옮겨진다 (AC14)", async () => {
    const { user, core } = await openProject({ files: ["docs/guide.md", "src/"] });
    await user.click(await findRow("docs"));
    const guide = await findRow("guide.md");

    fireEvent.dragStart(guide, transfer());
    fireEvent.dragOver(row("src"), transfer());
    expect(row("src")).toHaveClass("filerow--drop");
    expect(tree()).not.toHaveClass("filetree--drop");

    fireEvent.dragOver(tree(), transfer());
    expect(tree()).toHaveClass("filetree--drop");
    expect(row("src")).not.toHaveClass("filerow--drop");

    fireEvent.drop(tree(), transfer());
    fireEvent.dragEnd(guide, transfer());

    await expectPaths(core, ["docs/", "src/", "guide.md"]);
    expect(tree()).not.toHaveClass("filetree--drop");
  });

  it("같은 이름이 이미 있으면 옮겨지지 않고 이유가 표시된다 (AC15)", async () => {
    const { core } = await openProject({ files: ["docs/readme.md", "readme.md"] });
    await drag(await findRow("readme.md"), row("docs"));

    await waitFor(() => expect(note()).toHaveTextContent("같은 이름이 이미 있어 옮기지 않았습니다"));
    expect(core.paths(ALPHA)).toEqual(["docs/", "docs/readme.md", "readme.md"]);
  });

  it("폴더를 자기 자신이나 자기 안의 폴더에 놓아도 아무것도 바뀌지 않는다 (AC16)", async () => {
    const { user, core } = await openProject({ files: ["src/util/"] });
    await user.click(await findRow("src"));
    await findRow("util");

    fireEvent.dragStart(row("src"), transfer());
    fireEvent.dragOver(row("util"), transfer());
    expect(row("util")).not.toHaveClass("filerow--drop");
    fireEvent.drop(row("util"), transfer());
    fireEvent.drop(row("src"), transfer());
    fireEvent.dragEnd(row("src"), transfer());

    expect(core.mutations()).toBe(0);
    expect(core.paths(ALPHA)).toEqual(["src/", "src/util/"]);
  });
});

describe("우클릭 메뉴", () => {
  it("줄을 우클릭하면 일곱 가지가, 빈 곳을 우클릭하면 세 가지가 나오고, 밖을 누르거나 Esc로 닫힌다 (AC17)", async () => {
    const { user } = await openProject();
    await rightClick(user, await findRow("readme.md"));
    expect(menuItems()).toEqual(["새 파일", "새 폴더", "잘라내기", "복사", "붙여넣기", "이름 바꾸기", "지우기"]);
    expect(selectedNames()).toEqual(["readme.md"]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await rightClick(user, tree());
    expect(menuItems()).toEqual(["새 파일", "새 폴더", "붙여넣기"]);

    fireEvent.mouseDown(document.querySelector(".menu-backdrop")!);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("여러 개를 선택하면 이름 바꾸기는 눌리지 않는다 (AC22)", async () => {
    const { user } = await openProject();
    await user.click(await findRow("notes.txt"));
    await user.keyboard("{Control>}");
    await user.click(row("readme.md"));
    await user.keyboard("{/Control}");

    await rightClick(user, row("readme.md"));
    expect(selectedNames()).toEqual(["notes.txt", "readme.md"]);
    expect(screen.getByRole("menuitem", { name: "이름 바꾸기" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "지우기" })).toBeEnabled();
  });

  it("복사하거나 잘라낸 것이 없으면 붙여넣기가 눌리지 않는다 (AC34)", async () => {
    const { user } = await openProject();
    await rightClick(user, await findRow("readme.md"));
    expect(screen.getByRole("menuitem", { name: "붙여넣기" })).toBeDisabled();

    await user.click(screen.getByRole("menuitem", { name: "복사" }));
    await rightClick(user, row("docs"));
    expect(screen.getByRole("menuitem", { name: "붙여넣기" })).toBeEnabled();
  });
});

describe("이름 바꾸기", () => {
  it("메뉴에서 고르면 이름이 입력 칸으로 바뀌고 Enter로 반영된다 (AC18)", async () => {
    const { user, core } = await openProject({ files: ["readme.md"] });
    await rightClick(user, await findRow("readme.md"));
    await user.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));

    const input = screen.getByRole("textbox", { name: "새 이름" });
    expect(input).toHaveValue("readme.md");
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "intro.md{Enter}");

    await expectPaths(core, ["intro.md"]);
    expect(await findRow("intro.md")).toBeInTheDocument();
    expect(tree()).toHaveFocus();
  });

  it("F2로 시작하고 Esc를 누르면 원래 이름으로 남는다 (AC18)", async () => {
    const { user, core } = await openProject({ files: ["readme.md"] });
    await user.click(await findRow("readme.md"));
    await user.keyboard("{F2}");

    const input = screen.getByRole("textbox", { name: "새 이름" });
    await user.clear(input);
    await user.type(input, "other.md{Escape}");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(row("readme.md")).toBeInTheDocument();
    expect(core.mutations()).toBe(0);

    // Esc 뒤에도 키보드가 파일 칸에 남아 있어 바로 다시 시작할 수 있다
    expect(tree()).toHaveFocus();
    await user.keyboard("{F2}");
    expect(screen.getByRole("textbox", { name: "새 이름" })).toHaveFocus();
  });

  it("이미 있는 이름이나 쓸 수 없는 글자면 바뀌지 않고 이유가 표시된다 (AC19)", async () => {
    const { user, core } = await openProject({ files: ["readme.md", "notes.txt"] });
    await user.click(await findRow("readme.md"));

    await user.keyboard("{F2}");
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "notes.txt{Enter}");
    await waitFor(() => expect(note()).toHaveTextContent("같은 이름이 이미 있어 이름을 바꾸지 않았습니다"));

    await user.click(row("readme.md"));
    await user.keyboard("{F2}");
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "a?b.md{Enter}");
    await waitFor(() => expect(note()).toHaveTextContent("이 이름은 쓸 수 없습니다"));

    expect(core.paths(ALPHA)).toEqual(["notes.txt", "readme.md"]);
  });
});

describe("새로 만들기", () => {
  it("폴더를 우클릭해 새 파일을 고르면 그 폴더 안에 입력 칸이 생기고 Enter로 만들어진다 (AC20)", async () => {
    const { user, core } = await openProject({ files: ["src/main.ts", "readme.md"] });
    await rightClick(user, await findRow("src"));
    await user.click(screen.getByRole("menuitem", { name: "새 파일" }));

    const input = await screen.findByRole("textbox", { name: "새 파일 이름" });
    expect(input).toHaveFocus();
    await user.type(input, "new.ts{Enter}");

    await expectPaths(core, ["src/", "src/main.ts", "src/new.ts", "readme.md"]);
    expect(await findRow("new.ts")).toHaveAttribute("aria-level", "2");
    expect(selectedNames()).toEqual(["new.ts"]);
  });

  it("파일을 우클릭하면 그 파일이 있는 폴더에, 빈 곳이면 프로젝트 폴더 바로 아래에 만든다 (AC20)", async () => {
    const { user, core } = await openProject({ files: ["src/main.ts"] });
    await user.click(await findRow("src"));
    await rightClick(user, await findRow("main.ts"));
    await user.click(screen.getByRole("menuitem", { name: "새 폴더" }));
    await user.type(await screen.findByRole("textbox", { name: "새 폴더 이름" }), "lib{Enter}");
    await expectPaths(core, ["src/", "src/lib/", "src/main.ts"]);

    await rightClick(user, tree());
    await user.click(screen.getByRole("menuitem", { name: "새 파일" }));
    await user.type(await screen.findByRole("textbox", { name: "새 파일 이름" }), "top.txt{Enter}");
    await expectPaths(core, ["src/", "src/lib/", "src/main.ts", "top.txt"]);
  });

  it("이름을 비운 채 Enter를 누르거나 Esc를 누르면 아무것도 만들어지지 않는다 (AC20)", async () => {
    const { user, core } = await openProject({ files: ["readme.md"] });
    await rightClick(user, tree());
    await user.click(screen.getByRole("menuitem", { name: "새 파일" }));
    await user.type(await screen.findByRole("textbox"), "{Enter}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await rightClick(user, tree());
    await user.click(screen.getByRole("menuitem", { name: "새 폴더" }));
    await user.type(await screen.findByRole("textbox"), "temp{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(tree()).toHaveFocus();

    expect(core.mutations()).toBe(0);
    expect(core.paths(ALPHA)).toEqual(["readme.md"]);
  });
});

describe("지우기", () => {
  it("확인 창에서 확인을 누르면 휴지통으로 가고, 취소를 누르면 그대로다 (AC21)", async () => {
    const { user, core } = await openProject({ files: ["readme.md", "notes.txt"] });
    await user.click(await findRow("readme.md"));
    await user.keyboard("{Delete}");

    const dialog = screen.getByRole("alertdialog", { name: "지우기 확인" });
    expect(dialog).toHaveTextContent("readme.md을 휴지통으로 보냅니다");
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(core.trashed).toEqual([]);

    await rightClick(user, row("readme.md"));
    await user.click(screen.getByRole("menuitem", { name: "지우기" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "확인" }));

    await expectPaths(core, ["notes.txt"]);
    expect(core.trashed).toEqual(["readme.md"]);
    await waitFor(() => expect(rowNames()).toEqual(["notes.txt"]));
  });

  it("여러 개를 선택하고 지우면 개수를 묻고 모두 지운다 (AC21, AC22)", async () => {
    const { user, core } = await openProject({ files: ["a.txt", "b.txt", "c.txt"] });
    await user.click(await findRow("a.txt"));
    await user.keyboard("{Shift>}");
    await user.click(row("b.txt"));
    await user.keyboard("{/Shift}{Delete}");

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("2개를 휴지통으로 보냅니다");
    await user.click(within(dialog).getByRole("button", { name: "확인" }));

    await expectPaths(core, ["c.txt"]);
  });

  it("다른 프로그램이 쓰는 중이면 하지 못했다는 것과 이유가 표시된다 (AC26)", async () => {
    const { user, core } = await openProject({ files: ["docs/", "readme.md"] });
    await findRow("readme.md");

    core.failNext("in_use");
    await drag(row("readme.md"), row("docs"));
    await waitFor(() =>
      expect(note()).toHaveTextContent("옮기기를 하지 못했습니다: 다른 프로그램이 쓰고 있는 파일이 있습니다"),
    );

    core.failNext("in_use");
    await user.click(row("readme.md"));
    await user.keyboard("{Delete}");
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "확인" }));
    await waitFor(() => expect(note()).toHaveTextContent("지우기를 하지 못했습니다"));

    expect(core.paths(ALPHA)).toEqual(["docs/", "readme.md"]);

    await user.click(screen.getByRole("button", { name: "알림 닫기" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("복사, 잘라내기, 붙여넣기", () => {
  it("복사한 뒤 다른 폴더를 선택하고 붙여넣으면 사본이 생기고 원래 것은 남는다 (AC29)", async () => {
    const { user, core } = await openProject({ files: ["docs/", "src/main.ts", "readme.md"] });
    await user.click(await findRow("readme.md"));
    await user.keyboard("{Control>}c{/Control}");
    await user.click(row("docs"));
    await user.keyboard("{Control>}v{/Control}");

    await expectPaths(core, ["docs/", "docs/readme.md", "src/", "src/main.ts", "readme.md"]);

    await rightClick(user, row("src"));
    await user.click(screen.getByRole("menuitem", { name: "복사" }));
    await rightClick(user, row("docs"));
    await user.click(screen.getByRole("menuitem", { name: "붙여넣기" }));

    await expectPaths(core, [
      "docs/", "docs/readme.md", "docs/src/", "docs/src/main.ts", "src/", "src/main.ts", "readme.md",
    ]);
  });

  it("잘라내면 흐리게 표시되고, 붙여넣으면 옮겨지며 흐린 표시가 사라진다 (AC30)", async () => {
    const { user, core } = await openProject({ files: ["docs/", "readme.md"] });
    await user.click(await findRow("readme.md"));
    await user.keyboard("{Control>}x{/Control}");
    expect(row("readme.md")).toHaveClass("filerow--cut");

    await user.click(row("docs"));
    await user.keyboard("{Control>}v{/Control}");

    await expectPaths(core, ["docs/", "docs/readme.md"]);
    expect(await findRow("readme.md")).not.toHaveClass("filerow--cut");

    // 잘라낸 것은 한 번 붙여넣으면 끝난다
    await rightClick(user, row("docs"));
    expect(screen.getByRole("menuitem", { name: "붙여넣기" })).toBeDisabled();
  });

  it("붙여넣기 전에 Esc를 누르면 흐린 표시가 사라지고 아무것도 옮겨지지 않는다 (AC30)", async () => {
    const { user, core } = await openProject({ files: ["docs/", "readme.md"] });
    await user.click(await findRow("readme.md"));
    await user.keyboard("{Control>}x{/Control}");
    await user.keyboard("{Escape}");
    expect(row("readme.md")).not.toHaveClass("filerow--cut");

    await user.click(row("docs"));
    await user.keyboard("{Control>}v{/Control}");
    expect(core.mutations()).toBe(0);
  });

  it("파일을 선택하고 붙여넣으면 그 파일이 있는 폴더에, 빈 곳 메뉴에서 붙여넣으면 프로젝트 폴더 바로 아래에 들어간다 (AC31)", async () => {
    const { user, core } = await openProject({ files: ["src/main.ts", "docs/guide.md", "readme.md"] });
    await user.click(await findRow("src"));
    await user.click(await findRow("docs"));
    await user.click(await findRow("readme.md"));
    await user.keyboard("{Control>}c{/Control}");

    await user.click(await findRow("main.ts"));
    await user.keyboard("{Control>}v{/Control}");
    await waitFor(() => expect(core.paths(ALPHA)).toContain("src/readme.md"));

    await user.click(row("guide.md"));
    await user.keyboard("{Control>}c{/Control}");
    await rightClick(user, tree());
    await user.click(screen.getByRole("menuitem", { name: "붙여넣기" }));
    await waitFor(() => expect(core.paths(ALPHA)).toContain("guide.md"));
  });

  it("같은 이름이 있는 곳에 복사하면 복사본 이름으로 만들어진다 (AC32)", async () => {
    const { user, core } = await openProject({ files: ["readme.md"] });
    await user.click(await findRow("readme.md"));
    await user.keyboard("{Control>}c{/Control}");
    await user.keyboard("{Control>}v{/Control}");
    await expectPaths(core, ["readme.md", "readme - 복사본.md"]);

    await user.click(row("readme.md"));
    await user.keyboard("{Control>}v{/Control}");
    await expectPaths(core, ["readme.md", "readme - 복사본.md", "readme - 복사본 (2).md"]);
  });

  it("잘라낸 것을 같은 이름이 있는 폴더에 붙여넣으면 옮겨지지 않고 이유가 표시된다 (AC33)", async () => {
    const { user, core } = await openProject({ files: ["docs/readme.md", "readme.md"] });
    await user.click(await findRow("readme.md"));
    await user.keyboard("{Control>}x{/Control}");
    await user.click(row("docs"));
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() => expect(note()).toHaveTextContent("같은 이름이 이미 있어 옮기지 않았습니다"));
    expect(core.paths(ALPHA)).toEqual(["docs/", "docs/readme.md", "readme.md"]);
  });

  it("폴더를 자기 안에 붙여넣으면 아무것도 바뀌지 않고 이유가 표시된다 (AC34)", async () => {
    const { user, core } = await openProject({ files: ["src/util/"] });
    await user.click(await findRow("src"));
    await user.keyboard("{Control>}c{/Control}");
    await user.click(await findRow("util"));
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() => expect(note()).toHaveTextContent("폴더를 자기 자신 안에는 붙여넣을 수 없습니다"));
    expect(core.paths(ALPHA)).toEqual(["src/", "src/util/"]);
  });

  it("붙여넣기가 진행되는 동안 복사하는 중이 표시되고, 끝나면 사라진다 (AC35)", async () => {
    const { user, core } = await openProject({ files: ["docs/", "readme.md"] });
    await user.click(await findRow("readme.md"));
    await user.keyboard("{Control>}c{/Control}");
    await user.click(row("docs"));

    const release = core.holdCopy();
    await user.keyboard("{Control>}v{/Control}");
    expect(await screen.findByText("복사하는 중")).toHaveClass("filenote--busy");

    // 복사 중에도 다른 조작을 받는다
    await user.click(row("readme.md"));
    expect(selectedNames()).toEqual(["readme.md"]);

    release();
    await waitFor(() => expect(screen.queryByText("복사하는 중")).not.toBeInTheDocument());
    await expectPaths(core, ["docs/", "docs/readme.md", "readme.md"]);
  });
});

describe("되돌리기", () => {
  it("Ctrl+Z를 누를 때마다 최근 작업부터 차례로 되돌리고 무엇을 되돌렸는지 알린다 (AC23, AC24)", async () => {
    const { user, core } = await openProject({ files: ["docs/", "readme.md"] });
    await drag(await findRow("readme.md"), row("docs"));
    await expectPaths(core, ["docs/", "docs/readme.md"]);

    await user.click(await findRow("readme.md"));
    await user.keyboard("{F2}");
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "intro.md{Enter}");
    await expectPaths(core, ["docs/", "docs/intro.md"]);

    await rightClick(user, tree());
    await user.click(screen.getByRole("menuitem", { name: "새 파일" }));
    await user.type(await screen.findByRole("textbox"), "new.txt{Enter}");
    await expectPaths(core, ["docs/", "docs/intro.md", "new.txt"]);

    await user.click(await findRow("new.txt"));
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(note()).toHaveTextContent("되돌림: new.txt를 새로 만든 것"));
    await expectPaths(core, ["docs/", "docs/intro.md"]);

    await user.click(tree());
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(note()).toHaveTextContent("되돌림: readme.md의 이름을 intro.md로 바꾼 것"));

    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(note()).toHaveTextContent("되돌림: readme.md를 docs로 옮긴 것"));
    await expectPaths(core, ["docs/", "readme.md"]);

    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(note()).toHaveTextContent("되돌릴 것이 없습니다"));
  });

  it("키의 물리 위치 값 없이 글자만 전달되는 키보드(화상 키보드, 원격 조작 등)에서도 Ctrl+C·X·V·Z가 동작한다", async () => {
    const { user, core } = await openProject({ files: ["docs/", "readme.md", "notes.txt"] });
    const press = (key: string) => fireEvent.keyDown(tree(), { key, code: "", ctrlKey: true });

    await user.click(await findRow("readme.md"));
    press("c");
    press("v");
    await expectPaths(core, ["docs/", "readme.md", "readme - 복사본.md", "notes.txt"]);

    press("Z");
    await expectPaths(core, ["docs/", "readme.md", "notes.txt"]);

    await user.click(row("notes.txt"));
    press("x");
    expect(row("notes.txt")).toHaveClass("filerow--cut");
  });

  it("되돌릴 수 없으면 이유가 표시된다 (AC25)", async () => {
    const { user, core } = await openProject({ files: ["readme.md"] });
    await user.click(await findRow("readme.md"));
    const undo = core.api.undo;
    core.api.undo = async () => ({ ok: false, error: "undo_name_taken" });
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(note()).toHaveTextContent("되돌리지 못했습니다: 원래 자리에 같은 이름이 생겼습니다"));

    core.api.undo = async () => ({ ok: false, error: "undo_missing" });
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(note()).toHaveTextContent("되돌리지 못했습니다: 파일이 없어졌습니다"));
    core.api.undo = undo;
    expect(core.paths(ALPHA)).toEqual(["readme.md"]);
  });
});
