import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { CoreApi } from "../../data/apiClient";
import { fakeCore as createFakeCore } from "../../test/fakeCore";
import { createFileTreeStore } from "../fileTree/fileTreeStore";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { createProjectTabsStore } from "./projectTabsStore";

/** 코어를 흉내 내는 가짜. picks에 넣어 둔 폴더가 "폴더 선택 창에서 고른 폴더"가 된다 */
const fakeCore = (picks: string[], missing: string[] = []) => createFakeCore({ picks, missing }).api;

async function renderWorkspace(api: CoreApi) {
  const store = createProjectTabsStore(api);
  const fileStore = createFileTreeStore(api, store);
  await store.load();
  render(<ProjectWorkspace store={store} fileStore={fileStore} captionWidth={138} />);
  return userEvent.setup();
}

const sidebar = () => screen.getByRole("complementary", { name: "하이어라키" });
/** 사이드바 맨 위에 표시된 프로젝트 이름 */
const sidebarProject = () => sidebar().querySelector(".sidebar__name");
const workArea = () => screen.getByRole("region", { name: "작업 영역" });
const tabNames = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);

describe("프로젝트 탭", () => {
  it("열린 프로젝트가 없으면 폴더 선택 화면이 보이고, 폴더를 고르면 탭과 사이드바에 폴더 이름이 표시된다 (AC2)", async () => {
    const user = await renderWorkspace(fakeCore(["C:\\work\\alpha"]));
    expect(screen.getByRole("region", { name: "프로젝트 폴더 선택" })).toBeInTheDocument();
    expect(tabNames()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "폴더 선택" }));

    expect(tabNames()).toEqual(["alpha"]);
    expect(within(sidebar()).getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "프로젝트 폴더 선택" })).not.toBeInTheDocument();
  });

  it("프로젝트 추가(+)로 폴더를 고르면 두 번째 탭이 생기고 선택된다 (AC3)", async () => {
    const user = await renderWorkspace(fakeCore(["C:\\work\\alpha", "C:\\work\\beta"]));
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));

    expect(tabNames()).toEqual(["alpha", "beta"]);
    expect(screen.getByRole("tab", { name: "beta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "alpha" })).toHaveAttribute("aria-selected", "false");
  });

  it("탭을 누르면 사이드바와 작업 영역이 그 프로젝트 것으로 바뀌고, 사이드바에는 그 프로젝트만 보인다 (AC4)", async () => {
    const user = await renderWorkspace(fakeCore(["C:\\work\\alpha", "C:\\work\\beta"]));
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));

    expect(sidebarProject()).toHaveTextContent(/^beta$/);
    expect(sidebar()).not.toHaveTextContent("alpha");
    expect(workArea()).toHaveTextContent("beta · 열린 창이 없습니다");

    await user.click(screen.getByRole("tab", { name: "alpha" }));

    expect(sidebarProject()).toHaveTextContent(/^alpha$/);
    expect(sidebar()).not.toHaveTextContent("beta");
    expect(workArea()).toHaveTextContent("alpha · 열린 창이 없습니다");
  });

  it("탭을 닫으면 사라지고 옆 탭이 선택되며, 마지막 탭을 닫으면 폴더 선택 화면이 보인다 (AC5)", async () => {
    const user = await renderWorkspace(fakeCore(["C:\\work\\alpha", "C:\\work\\beta"]));
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));

    await user.click(screen.getByRole("button", { name: "beta 탭 닫기" }));
    expect(tabNames()).toEqual(["alpha"]);
    expect(screen.getByRole("tab", { name: "alpha" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "alpha 탭 닫기" }));
    expect(tabNames()).toEqual([]);
    expect(screen.getByRole("region", { name: "프로젝트 폴더 선택" })).toBeInTheDocument();
  });

  it("이미 열린 폴더를 다시 고르면 새 탭 없이 기존 탭이 선택된다 (AC6)", async () => {
    const user = await renderWorkspace(
      fakeCore(["C:\\work\\alpha", "C:\\work\\beta", "C:\\work\\alpha"]),
    );
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));

    expect(tabNames()).toEqual(["alpha", "beta"]);
    expect(screen.getByRole("tab", { name: "alpha" })).toHaveAttribute("aria-selected", "true");
  });

  it("폴더가 없어진 탭을 누르면 안내가 표시되고 탭을 닫을 수 있다 (AC8)", async () => {
    const user = await renderWorkspace(
      fakeCore(["C:\\work\\alpha", "C:\\work\\gone"], ["C:\\work\\gone"]),
    );
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));

    expect(workArea()).toHaveTextContent("폴더를 찾을 수 없습니다");

    await user.click(screen.getByRole("tab", { name: "alpha" }));
    expect(workArea()).toHaveTextContent("alpha · 열린 창이 없습니다");

    await user.click(screen.getByRole("button", { name: "gone 탭 닫기" }));
    expect(tabNames()).toEqual(["alpha"]);
  });

  it("폴더 선택을 취소하면 화면이 그대로다", async () => {
    const user = await renderWorkspace(fakeCore(["C:\\work\\alpha"]));
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));
    expect(tabNames()).toEqual(["alpha"]);
  });
});

describe("누를 수 있는 것 (AC9)", () => {
  const pressable = () =>
    [
      ...document.querySelectorAll(
        "button, a, input, select, textarea, summary, [role='button'], [role='link'], [role='menuitem'], [tabindex], [contenteditable]",
      ),
    ]
      .map((element) => element.getAttribute("aria-label") ?? element.textContent ?? "")
      .sort();

  it("프로젝트가 없을 때는 프로젝트 추가(+)와 폴더 선택뿐이다", async () => {
    await renderWorkspace(fakeCore([]));
    expect(pressable()).toEqual(["폴더 선택", "프로젝트 추가"].sort());
  });

  it("프로젝트가 열려 있을 때는 프로젝트 탭, 탭 닫기(×), 프로젝트 추가(+), 두 칸의 제목, 파일 칸뿐이다", async () => {
    const user = await renderWorkspace(fakeCore(["C:\\work\\alpha", "C:\\work\\beta"]));
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("button", { name: "프로젝트 추가" }));

    expect(pressable()).toEqual(
      ["alpha", "alpha 탭 닫기", "beta", "beta 탭 닫기", "프로젝트 추가", "▾에이전트", "▾파일", "파일"].sort(),
    );
  });
});

describe("코어 연결", () => {
  it("코어가 응답하지 않으면 연결이 끊겼다고 알린다", async () => {
    const api = fakeCore([]);
    api.fetchState = async () => {
      throw new Error("down");
    };
    await renderWorkspace(api);
    expect(screen.getByRole("status")).toHaveTextContent("코어와 연결이 끊겼습니다");
  });
});
