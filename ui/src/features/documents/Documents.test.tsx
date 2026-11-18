import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { documentKind, documentShareAt, resolveLink } from "../../domain/documents";
import { fakeCore } from "../../test/fakeCore";
import { fakeScreens } from "../../test/fakeScreen";
import { createFileTreeStore } from "../fileTree/fileTreeStore";
import { createLayoutStore } from "../layout/layoutStore";
import { ProjectWorkspace } from "../projectTabs/ProjectWorkspace";
import { createProjectTabsStore } from "../projectTabs/projectTabsStore";
import { createTerminalStore } from "../terminals/terminalStore";
import { createDocumentStore } from "./documentStore";

// 머메이드 그리기 부품은 실제 화면이 있어야 그린다. 여기서는 읽어 들였는지와 결과를 넣는 자리만 확인한다
const mermaid = vi.hoisted(() => ({ loaded: 0, drawn: [] as string[] }));
vi.mock("mermaid", () => {
  mermaid.loaded++;
  return {
    default: {
      initialize: () => undefined,
      render: (id: string, source: string) => {
        if (source.includes("broken")) return Promise.reject(new Error("parse error"));
        mermaid.drawn.push(source);
        return Promise.resolve({ svg: `<svg data-id="${id}"><text>diagram</text></svg>` });
      },
    },
  };
});

const ALPHA = "C:\\work\\alpha";
const BETA = "C:\\work\\beta";
const FILES = ["readme.md", "notes.txt", "page.html", "image.png", "docs/plan.md", "docs/deep/more.md", "src/main.ts"];

async function openProject(picks: string[] = [ALPHA]) {
  const core = fakeCore({ picks, files: { [ALPHA]: FILES, [BETA]: ["b.md"] } });
  core.writeFile(ALPHA, "notes.txt", "첫 줄\nsecond line\n\n넷째 줄\n");
  const screens = fakeScreens();
  const store = createProjectTabsStore(core.api);
  const fileStore = createFileTreeStore(core.api, store);
  const terminalStore = createTerminalStore(core.api, store, screens.create);
  const documentStore = createDocumentStore(core.api, store);
  await store.load();
  render(
    <ProjectWorkspace
      store={store}
      fileStore={fileStore}
      terminalStore={terminalStore}
      layoutStore={createLayoutStore(core.api)}
      documentStore={documentStore}
      captionWidth={138}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "폴더 선택" }));
  for (let extra = 1; extra < picks.length; extra++) {
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));
  }
  await screen.findByRole("treeitem", { name: picks.length > 1 ? "b.md" : "readme.md" });
  return { user, core, documentStore };
}

const file = (name: string) => screen.getByRole("treeitem", { name });
const pane = () => screen.getByRole("region", { name: "문서 창" });
const noPane = () => expect(screen.queryByRole("region", { name: "문서 창" })).not.toBeInTheDocument();
const docTabs = () => within(screen.getByRole("tablist", { name: "문서 탭" })).getAllByRole("tab");
const tabNames = () => docTabs().map((tab) => tab.textContent);
const selectedTab = () => docTabs().find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
const body = () => within(pane()).getByRole("document");
const lines = () => [...pane().querySelectorAll(".doc__line")].map((line) => line.textContent);

describe("문서 창: 규칙", () => {
  it("파일 이름으로 보여 주는 방법을 정한다 (AC2, AC4, AC5)", () => {
    expect(documentKind("docs/Plan.MD")).toBe("markdown");
    expect(documentKind("a.markdown")).toBe("markdown");
    expect(documentKind("site/index.html")).toBe("html");
    expect(documentKind("x.htm")).toBe("html");
    expect(documentKind("src/main.cpp")).toBe("text");
    expect(documentKind("Makefile")).toBe("text");
    expect(documentKind("md")).toBe("text");
  });

  it("링크가 가리키는 프로젝트 안의 파일을 찾는다. 웹 주소와 프로젝트 밖은 열지 않는다 (AC14)", () => {
    expect(resolveLink("docs/plan.md", "deep/more.md")).toBe("docs/deep/more.md");
    expect(resolveLink("docs/plan.md", "./deep/more.md#section")).toBe("docs/deep/more.md");
    expect(resolveLink("docs/plan.md", "../readme.md")).toBe("readme.md");
    expect(resolveLink("docs/plan.md", "/src/main.ts")).toBe("src/main.ts");
    expect(resolveLink("readme.md", "docs/%ED%95%9C%EA%B8%80.md")).toBe("docs/한글.md");
    expect(resolveLink("readme.md", "docs\\plan.md")).toBe("docs/plan.md");
    for (const href of ["https://example.com", "mailto:a@b.c", "javascript:alert(1)", "//host/x", "#top", "", "../outside.md", "../../x"]) {
      expect(resolveLink("readme.md", href), href).toBeNull();
    }
  });

  it("문서 경계는 터미널과 문서 창을 240px보다 좁히지 않는다 (AC10)", () => {
    // 작업 영역이 가로 300~1300 (너비 1000)
    expect(documentShareAt(800, 300, 1000)).toBeCloseTo(0.5);
    expect(documentShareAt(1000, 300, 1000)).toBeCloseTo(0.3);
    expect(documentShareAt(1290, 300, 1000)).toBeCloseTo(0.24);
    expect(documentShareAt(5000, 300, 1000)).toBeCloseTo(0.24);
    expect(documentShareAt(310, 300, 1000)).toBeCloseTo(0.76);
    expect(documentShareAt(-50, 300, 1000)).toBeCloseTo(0.76);
    // 둘 다 240px를 가질 수 없을 만큼 좁으면 반반
    expect(documentShareAt(350, 300, 400)).toBe(0.5);
  });
});

describe("문서 창: 열기", () => {
  it("문서를 열기 전에는 문서 창이 없고, 파일을 누르면 터미널 옆에 열려 내용이 보인다 (AC1, AC5)", async () => {
    const { user } = await openProject();
    noPane();
    await user.click(file("notes.txt"));
    await waitFor(() => expect(lines()).toEqual(["첫 줄", "second line", "\n", "넷째 줄"]));
    expect(tabNames()).toEqual(["notes.txt"]);
    expect(screen.getByRole("separator", { name: "문서 창 너비 조절" })).toBeInTheDocument();
    // 터미널은 그대로 있다
    expect(within(screen.getByRole("region", { name: "작업 영역" })).getByRole("group", { name: "터미널" })).toBeInTheDocument();
    // 글자 파일에는 원문 버튼이 없다
    expect(screen.queryByRole("button", { name: "원문" })).not.toBeInTheDocument();
  });

  it("폴더를 누르면 펼쳐질 뿐 열리지 않고, Ctrl·Shift를 누른 채 누르면 선택만 된다 (AC16)", async () => {
    const { user } = await openProject();
    await user.click(file("docs"));
    await screen.findByRole("treeitem", { name: "plan.md" });
    noPane();

    await user.keyboard("{Control>}");
    await user.click(file("notes.txt"));
    await user.keyboard("{/Control}{Shift>}");
    await user.click(file("readme.md"));
    await user.keyboard("{/Shift}");
    noPane();
    expect(file("notes.txt")).toHaveAttribute("aria-selected", "true");
  });

  it("마크다운은 제목·목록·표·코드·인용·굵은 글씨·체크 목록이 그려진다 (AC2)", async () => {
    const { user, core } = await openProject();
    core.writeFile(
      ALPHA,
      "readme.md",
      [
        "# 큰 제목",
        "",
        "본문 **굵게** 그리고 `코드`.",
        "",
        "- 하나",
        "- 둘",
        "",
        "- [ ] 할 일",
        "- [x] 한 일",
        "",
        "> 인용한 글",
        "",
        "| 이름 | 값 |",
        "|---|---|",
        "| a | 1 |",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "![그림 설명](pic.png)",
      ].join("\n"),
    );
    await user.click(file("readme.md"));
    await within(pane()).findByRole("heading", { level: 1, name: "큰 제목" });
    const doc = body();
    expect(doc.querySelector("strong")).toHaveTextContent("굵게");
    expect(doc.querySelector("p code")).toHaveTextContent("코드");
    expect(within(doc).getAllByRole("listitem").map((item) => item.textContent?.trim())).toEqual(["하나", "둘", "할 일", "한 일"]);
    const boxes = within(doc).getAllByRole("checkbox");
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([false, true]);
    expect(boxes.every((box) => (box as HTMLInputElement).disabled)).toBe(true);
    expect(doc.querySelector("blockquote")).toHaveTextContent("인용한 글");
    expect(within(doc).getByRole("table")).toHaveTextContent("이름 값 a 1");
    expect(doc.querySelector("pre code")).toHaveTextContent("const x = 1;");
    // 그림은 보여 주지 않고 설명만 남긴다 (OOS3)
    expect(doc.querySelector("img")).toBeNull();
    expect(doc).toHaveTextContent("[그림: 그림 설명]");
  });

  it("마크다운 안에 적힌 HTML 태그와 스크립트는 그리지 않고 글자로 보인다 (AS9)", async () => {
    const { user, core } = await openProject();
    core.writeFile(ALPHA, "readme.md", '안녕 <b id="x">굵게</b>\n\n<script>window.hacked = 1</script>\n\n[위험](javascript:alert(1))');
    await user.click(file("readme.md"));
    await waitFor(() => expect(body()).toHaveTextContent('<b id="x">굵게</b>'));
    expect(body().querySelector("b, script")).toBeNull();
    expect(body().querySelector('a[href^="javascript"]')).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it("머메이드 그림은 그림으로 바뀌고, 그릴 수 없으면 원래 글자와 알림이 남는다 (AC3)", async () => {
    const { user, core } = await openProject();
    core.writeFile(ALPHA, "readme.md", "# 흐름\n\n```mermaid\ngraph TD; A-->B;\n```\n\n```mermaid\nbroken diagram\n```\n");
    await user.click(file("readme.md"));
    await waitFor(() => expect(within(pane()).getByRole("img", { name: "머메이드 그림" })).toBeInTheDocument());
    expect(pane().querySelector(".doc__diagram svg")).not.toBeNull();
    expect(mermaid.drawn.some((source) => source.includes("A-->B"))).toBe(true);
    await within(pane()).findByText("그림을 그리지 못했습니다");
    expect(pane().querySelector("pre code.language-mermaid")).toHaveTextContent("broken diagram");
  });

  it("머메이드 그리기 부품은 머메이드 그림이 든 문서를 열 때 처음 읽어 들인다 (AC17)", async () => {
    const before = mermaid.loaded;
    const { user, core } = await openProject();
    core.writeFile(ALPHA, "readme.md", "# 그림 없는 문서\n\n```js\nlet a;\n```\n");
    await user.click(file("readme.md"));
    await within(pane()).findByRole("heading", { name: "그림 없는 문서" });
    expect(mermaid.loaded).toBe(before);
  });

  it("HTML 문서는 스크립트가 실행되지 않는 틀 안에 그려진다 (AC4)", async () => {
    const { user, core } = await openProject();
    const html = "<h1>안내</h1><script>document.title = 'hacked'</script>";
    core.writeFile(ALPHA, "page.html", html);
    await user.click(file("page.html"));
    const frame = await waitFor(() => {
      const found = pane().querySelector("iframe");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toBe(html);
    expect(frame).toHaveAttribute("title", "page.html");
  });

  it("원문 버튼으로 그려진 모습과 파일에 적힌 글자를 오간다 (AC6)", async () => {
    const { user, core } = await openProject();
    core.writeFile(ALPHA, "readme.md", "# 제목\n\n본문");
    await user.click(file("readme.md"));
    await within(pane()).findByRole("heading", { name: "제목" });
    const raw = screen.getByRole("button", { name: "원문" });
    expect(raw).toHaveAttribute("aria-pressed", "false");

    await user.click(raw);
    expect(lines()).toEqual(["# 제목", "\n", "본문"]);
    expect(within(pane()).queryByRole("heading")).not.toBeInTheDocument();
    expect(raw).toHaveAttribute("aria-pressed", "true");

    await user.click(raw);
    expect(within(pane()).getByRole("heading", { name: "제목" })).toBeInTheDocument();
  });

  it("열 수 없는 파일은 내용 대신 이유가 보인다 (AC11)", async () => {
    const { user, core } = await openProject();
    core.breakFile(ALPHA, "image.png", "not_text");
    core.breakFile(ALPHA, "notes.txt", "too_large");
    await user.click(file("image.png"));
    expect(await within(pane()).findByRole("alert")).toHaveTextContent("글자 파일이 아니어서 보여 줄 수 없습니다");
    await user.click(file("notes.txt"));
    await waitFor(() => expect(within(pane()).getByRole("alert")).toHaveTextContent("파일이 너무 커서 열지 않았습니다 (1MB 초과)"));
  });
});

describe("문서 창: 바뀌는 파일", () => {
  it("열어 둔 파일이 바뀌면 내용이 따라 바뀐다 (AC7)", async () => {
    const { user, core } = await openProject();
    await user.click(file("notes.txt"));
    await waitFor(() => expect(lines()).toHaveLength(4));
    const container = pane().querySelector(".doc");

    core.writeFile(ALPHA, "notes.txt", "에이전트가 고친 내용\n둘째 줄");
    await waitFor(() => expect(lines()).toEqual(["에이전트가 고친 내용", "둘째 줄"]));
    // 스크롤되는 자리는 그대로여서 읽던 위치가 유지된다
    expect(pane().querySelector(".doc")).toBe(container);

    core.writeFile(ALPHA, "notes.txt", "또 고침");
    await waitFor(() => expect(lines()).toEqual(["또 고침"]));
  });

  it("그려진 마크다운도 파일이 바뀌면 다시 그려진다 (AC7)", async () => {
    const { user, core } = await openProject();
    core.writeFile(ALPHA, "readme.md", "# 처음");
    await user.click(file("readme.md"));
    await within(pane()).findByRole("heading", { name: "처음" });
    core.writeFile(ALPHA, "readme.md", "# 나중\n\n```mermaid\ngraph LR; X-->Y;\n```");
    await within(pane()).findByRole("heading", { name: "나중" });
    await within(pane()).findByRole("img", { name: "머메이드 그림" });
  });

  it("열어 둔 파일이 지워지면 찾을 수 없다고 알리고, 다시 생기면 내용이 보인다 (AC12)", async () => {
    const { user, core } = await openProject();
    await user.click(file("notes.txt"));
    await waitFor(() => expect(lines()).toHaveLength(4));

    core.external(ALPHA, (files) => files.delete("notes.txt"));
    expect(await within(pane()).findByRole("alert")).toHaveTextContent("파일을 찾을 수 없습니다");
    expect(tabNames()).toEqual(["notes.txt"]);

    core.writeFile(ALPHA, "notes.txt", "돌아왔다");
    await waitFor(() => expect(lines()).toEqual(["돌아왔다"]));
  });
});

describe("문서 창: 문서 탭", () => {
  it("여러 파일을 열면 문서 탭이 하나씩 생기고, 이미 연 파일을 다시 누르면 그 탭이 보인다 (AC8)", async () => {
    const { user, core } = await openProject();
    core.writeFile(ALPHA, "readme.md", "# 읽어 보기");
    await user.click(file("notes.txt"));
    await user.click(file("readme.md"));
    await within(pane()).findByRole("heading", { name: "읽어 보기" });
    expect(tabNames()).toEqual(["notes.txt", "readme.md"]);
    expect(selectedTab()).toBe("readme.md");

    await user.click(file("notes.txt"));
    expect(tabNames()).toEqual(["notes.txt", "readme.md"]);
    expect(selectedTab()).toBe("notes.txt");
    await waitFor(() => expect(lines()).toHaveLength(4));

    await user.click(within(pane()).getByRole("tab", { name: "readme.md" }));
    expect(selectedTab()).toBe("readme.md");
    expect(within(pane()).getByRole("heading", { name: "읽어 보기" })).toBeInTheDocument();
  });

  it("가려져 있던 문서는 탭을 눌러 볼 때 바뀐 내용으로 보인다 (AS6)", async () => {
    const { user, core } = await openProject();
    await user.click(file("notes.txt"));
    await waitFor(() => expect(lines()).toHaveLength(4));
    await user.click(file("readme.md"));
    core.writeFile(ALPHA, "notes.txt", "가려진 동안 바뀜");
    await user.click(within(pane()).getByRole("tab", { name: "notes.txt" }));
    await waitFor(() => expect(lines()).toEqual(["가려진 동안 바뀜"]));
  });

  it("문서 탭의 ×로 닫고, 마지막 문서를 닫으면 문서 창이 사라진다 (AC9)", async () => {
    const { user } = await openProject();
    await user.click(file("notes.txt"));
    await user.click(file("readme.md"));
    await user.click(file("page.html"));
    expect(tabNames()).toEqual(["notes.txt", "readme.md", "page.html"]);

    // 보고 있지 않은 문서를 닫으면 보던 문서는 그대로다
    await user.click(screen.getByRole("button", { name: "notes.txt 문서 닫기" }));
    expect(tabNames()).toEqual(["readme.md", "page.html"]);
    expect(selectedTab()).toBe("page.html");

    // 보던 문서를 닫으면 옆 문서가 보인다
    await user.click(screen.getByRole("button", { name: "page.html 문서 닫기" }));
    expect(selectedTab()).toBe("readme.md");

    await user.click(screen.getByRole("button", { name: "readme.md 문서 닫기" }));
    noPane();
    expect(screen.queryByRole("separator", { name: "문서 창 너비 조절" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "작업 영역" })).getByRole("group", { name: "터미널" })).toBeInTheDocument();
  });

  it("프로젝트 탭마다 열어 둔 문서가 따로이고, 돌아오면 그대로다 (AC13)", async () => {
    const { user, core } = await openProject([ALPHA, BETA]);
    core.writeFile(BETA, "b.md", "# 베타 문서");
    await user.click(file("b.md"));
    await within(pane()).findByRole("heading", { name: "베타 문서" });

    await user.click(screen.getByRole("tab", { name: "alpha" }));
    await screen.findByRole("treeitem", { name: "notes.txt" });
    noPane();
    await user.click(file("notes.txt"));
    await user.click(file("readme.md"));
    await user.click(within(pane()).getByRole("tab", { name: "notes.txt" }));

    await user.click(screen.getByRole("tab", { name: "beta" }));
    await waitFor(() => expect(tabNames()).toEqual(["b.md"]));
    expect(within(pane()).getByRole("heading", { name: "베타 문서" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "alpha" }));
    await waitFor(() => expect(tabNames()).toEqual(["notes.txt", "readme.md"]));
    expect(selectedTab()).toBe("notes.txt");
  });

  it("프로젝트 탭을 닫으면 그 탭의 문서도 없어진다", async () => {
    const { user, documentStore } = await openProject([ALPHA, BETA]);
    await user.click(file("b.md"));
    expect(tabNames()).toEqual(["b.md"]);
    await user.click(screen.getByRole("button", { name: "beta 탭 닫기" }));
    await screen.findByRole("treeitem", { name: "notes.txt" });
    noPane();
    expect(documentStore.getSnapshot().documents).toEqual([]);
  });
});

describe("문서 창: 링크와 경계", () => {
  it("프로젝트 안의 파일을 가리키는 링크를 누르면 그 파일이 열리고, 웹 주소 링크는 아무 데도 가지 않는다 (AC14)", async () => {
    const { user, core } = await openProject();
    core.writeFile(ALPHA, "readme.md", "[계획](docs/plan.md) 그리고 [바깥](https://example.com/page)");
    core.writeFile(ALPHA, "docs/plan.md", "# 계획 문서");
    await user.click(file("readme.md"));
    const outside = await within(pane()).findByRole("link", { name: "바깥" });
    const before = window.location.href;
    await user.click(outside);
    expect(window.location.href).toBe(before);
    expect(tabNames()).toEqual(["readme.md"]);

    await user.click(within(pane()).getByRole("link", { name: "계획" }));
    await within(pane()).findByRole("heading", { name: "계획 문서" });
    expect(tabNames()).toEqual(["readme.md", "plan.md"]);
  });

  it("문서 경계를 끌거나 방향키로 옮기면 문서 창의 몫이 바뀌고, 처음 값은 반반이다 (AC10)", async () => {
    const { user, documentStore } = await openProject();
    await user.click(file("notes.txt"));
    const bounds = { left: 300, width: 1000 };
    expect(documentStore.getSnapshot().share).toBe(0.5);
    expect(pane().style.flexBasis).toBe("50%");

    documentStore.resize(1000, bounds);
    await waitFor(() => expect(pane().style.flexBasis).toBe("30%"));
    documentStore.nudge(1, bounds);
    expect(documentStore.getSnapshot().share).toBeCloseTo(0.284);
    documentStore.nudge(-1, bounds);
    expect(documentStore.getSnapshot().share).toBeCloseTo(0.3);
    documentStore.resize(99999, bounds);
    expect(documentStore.getSnapshot().share).toBeCloseTo(0.24);

    documentStore.resetShare();
    await waitFor(() => expect(pane().style.flexBasis).toBe("50%"));
  });
});
