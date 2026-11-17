// 실제 앱 창과 실제 파일로 파일 칸의 인수 기준(SPEC-20261116-file-explorer)을 확인한다. 실행: npm run e2e
// 마우스 커서는 움직이지 않는다. 지운 것은 실제 휴지통 대신 임시 폴더(VA_TRASH_DIR)로 간다.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, afterEach, before, describe, test } from "node:test";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

describe("파일 칸", () => {
  let sandbox;
  let app;
  let page;
  let alpha;
  let beta;
  let outside;

  /** 프로젝트 폴더 안의 실제 위치 */
  const at = (path) => join(alpha, ...path.split("/"));
  const exists = (path) => existsSync(at(path));
  const content = (path) => readFileSync(at(path), "utf8");
  function put(path, text = "") {
    mkdirSync(dirname(at(path)), { recursive: true });
    writeFileSync(at(path), text);
  }

  const row = (path) => page.locator(`[role=treeitem][data-path="${path}"]`);
  const tree = () => page.getByRole("tree", { name: "파일" });
  const note = () => page.locator(".filenote:not(.filenote--busy)");
  const menuItem = (name) => page.getByRole("menuitem", { name, exact: true });
  const childNames = async (folder) =>
    page.evaluate(
      (prefix) =>
        [...document.querySelectorAll("[role=treeitem]")]
          .map((item) => item.dataset.path)
          .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
          .map((path) => path.slice(prefix.length)),
      folder === "" ? "" : `${folder}/`,
    );
  const selected = () =>
    page.evaluate(() => [...document.querySelectorAll("[role=treeitem][aria-selected=true]")].map((item) => item.dataset.path));

  /** 테스트 하나가 쓸 폴더를 만들고 펼친다. 앱 밖에서 만든 것이 파일 칸에 나타나는 것도 함께 확인된다 */
  async function seed(folder, files) {
    mkdirSync(at(folder), { recursive: true });
    for (const [path, text] of Object.entries(files)) {
      if (path.endsWith("/")) mkdirSync(at(`${folder}/${path}`), { recursive: true });
      else put(`${folder}/${path}`, text);
    }
    await row(folder).waitFor();
    await row(folder).click();
    await page.waitForFunction((path) => document.querySelector(`[data-path="${path}"]`)?.getAttribute("aria-expanded") === "true", folder);
  }

  /** 파일 칸 맨 아래의 빈 곳 (화면 좌표가 아니라 화면 안 좌표) */
  async function blankSpot() {
    await tree().evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const box = await tree().boundingBox();
    return { x: box.x + 60, y: box.y + box.height - 12 };
  }

  async function typeName(label, name) {
    const input = page.getByRole("textbox", { name: label });
    await input.fill(name);
    await input.press("Enter");
  }

  /** 다른 프로그램이 파일을 쓰고 있는 상황을 만든다. 돌려받은 함수를 부르면 놓는다 */
  function lockFile(path) {
    return new Promise((done, fail) => {
      const script = `$f = [System.IO.File]::Open('${path.replaceAll("'", "''")}', 'Open', 'Read', 'None'); Write-Output locked; [Console]::In.ReadLine() | Out-Null; $f.Close()`;
      const holder = spawn("powershell.exe", ["-NoProfile", "-Command", script], { stdio: ["pipe", "pipe", "inherit"] });
      holder.once("error", fail);
      holder.stdout.once("data", () =>
        done(() => new Promise((released) => {
          holder.once("exit", released);
          holder.stdin.end("\n");
        })),
      );
    });
  }

  /** 화면이 쓰는 것과 같은 접속 값으로 코어에 직접 요청한다 */
  const callCore = (action, body) =>
    page.evaluate(
      async ([name, payload]) => {
        const state = await (await fetch("/api/state", { headers: { "X-VA-Token": window.__VA__.token } })).json();
        const response = await fetch(`/api/tabs/${state.activeId}/files/${name}`, {
          method: "POST",
          headers: { "X-VA-Token": window.__VA__.token, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        return { status: response.status, body: await response.json() };
      },
      [action, body],
    );

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    beta = sandbox.project("beta");
    outside = join(sandbox.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "secret");

    put("docs/guide.md", "guide");
    put("src/main.ts", "main");
    put("src/util/text.ts", "text");
    mkdirSync(at("assets"));
    put(".git/config", "git");
    put("readme.md", "readme");
    put("notes.txt", "notes");
    put("Zeta.txt", "zeta");
    writeFileSync(join(beta, "b.txt"), "b");

    app = await launchApp(sandbox);
    page = app.page;
    page.setDefaultTimeout(10000);
    app.place(80, 60, 1280, 900);
    app.pickNext(alpha);
    await page.getByRole("button", { name: "폴더 선택" }).click();
    await row("readme.md").waitFor();
  });

  // 테스트 하나가 실패해도 열린 메뉴·확인 창·끌기가 다음 테스트를 막지 않게 하고, 쓴 폴더를 치운다
  afterEach(async () => {
    await page.mouse.up();
    await page.evaluate(() => {
      document.querySelector(".menu-backdrop")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      for (const button of document.querySelectorAll(".dialog__button")) {
        if (button.textContent === "취소") button.click();
      }
    });
    for (const name of readdirSync(alpha)) {
      if (/^t\d+$/.test(name)) rmSync(at(name), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    await page.waitForFunction(() => ![...document.querySelectorAll("[role=treeitem]")].some((item) => /^t\d+$/.test(item.dataset.path)));
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC1 AC2 사이드바가 위아래 두 칸이고, 에이전트 칸에는 에이전트가 없다고 표시된다", async () => {
    const agents = page.getByRole("region", { name: "에이전트 칸" });
    const files = page.getByRole("region", { name: "파일 칸" });
    const agentsBox = await agents.boundingBox();
    const filesBox = await files.boundingBox();
    assert.ok(agentsBox.y + agentsBox.height <= filesBox.y + 1, "에이전트 칸이 파일 칸 위에 있다");
    assert.ok(Math.abs(agentsBox.height - filesBox.height) <= 1, "두 칸이 높이를 반씩 나눠 쓴다");
    assert.match(await agents.locator(".pane__title").innerText(), /에이전트$/);
    await agents.getByRole("list", { name: "터미널 목록" }).waitFor();
    assert.match(await files.locator(".pane__title").innerText(), /파일$/);
  });

  test("AC3 폴더가 먼저, 그다음 파일이 이름순이고 .git은 보이지 않는다", async () => {
    assert.deepEqual(await childNames(""), ["assets", "docs", "src", "notes.txt", "readme.md", "Zeta.txt"]);
    assert.equal(await row("docs").getAttribute("data-kind"), "folder");
    assert.equal(await row("readme.md").getAttribute("data-kind"), "file");
    assert.equal(await row("docs").locator(".filerow__icon--folder").count(), 1);
    assert.equal(await row("readme.md").locator(".filerow__icon--file").count(), 1);
    app.screenshot("AC1-AC3-two-panes.png");
  });

  test("AC4 폴더를 누르면 들여쓰기되어 펼쳐지고, 여러 단계까지 펼쳐지며, 다시 누르면 접힌다", async () => {
    await row("src").click();
    await row("src/main.ts").waitFor();
    await row("src/util").click();
    await row("src/util/text.ts").waitFor();

    const indent = async (path) => (await row(path).locator(".filerow__name").boundingBox()).x;
    assert.ok((await indent("src")) < (await indent("src/main.ts")), "한 단계 들여쓰기");
    assert.ok((await indent("src/main.ts")) < (await indent("src/util/text.ts")), "두 단계 들여쓰기");
    app.screenshot("AC4-expanded-folders.png");

    await row("src").click();
    await row("src/main.ts").waitFor({ state: "detached" });
    assert.equal(await row("src").getAttribute("aria-expanded"), "false");
  });

  test("AC5 칸 제목을 누르면 제목만 남고 다른 칸이 넓어지며, 다시 누르면 펼쳐진다", async () => {
    const agents = page.getByRole("region", { name: "에이전트 칸" });
    const files = page.getByRole("region", { name: "파일 칸" });
    const before = await files.boundingBox();

    await agents.locator(".pane__title").click();
    assert.equal((await agents.boundingBox()).height, 31, "제목 줄(30px)과 경계선만 남는다");
    assert.ok((await files.boundingBox()).height > before.height + 100, "파일 칸이 넓어진다");
    app.screenshot("AC5-agents-collapsed.png");

    await agents.locator(".pane__title").click();
    assert.ok(Math.abs((await files.boundingBox()).height - before.height) <= 1);

    await files.locator(".pane__title").click();
    assert.equal(await tree().count(), 0);
    await files.locator(".pane__title").click();
    await row("readme.md").waitFor();
  });

  test("AC6 앱 밖에서 파일을 만들거나 지우거나 옮기면 3초 안에 따라 바뀐다", async () => {
    await row("docs").click();
    await row("docs/guide.md").waitFor();

    let started = Date.now();
    put("docs/outside-made.md");
    await row("docs/outside-made.md").waitFor({ timeout: 3000 });
    const createdIn = Date.now() - started;

    started = Date.now();
    rmSync(at("docs/outside-made.md"));
    await row("docs/outside-made.md").waitFor({ state: "detached", timeout: 3000 });
    const removedIn = Date.now() - started;

    mkdirSync(at("made-outside"));
    await row("made-outside").waitFor({ timeout: 3000 });
    rmSync(at("made-outside"), { recursive: true });
    await row("made-outside").waitFor({ state: "detached", timeout: 3000 });

    console.log(`  밖에서 만든 파일이 보이기까지 ${createdIn}ms, 지운 파일이 사라지기까지 ${removedIn}ms`);
    await row("docs").click();
  });

  test("AC7 프로젝트 탭을 바꾸면 그 프로젝트의 폴더로 바뀌고, 돌아오면 펼쳐 둔 폴더가 그대로다", async () => {
    await row("src").click();
    await row("src/main.ts").waitFor();

    app.pickNext(beta);
    await page.getByRole("button", { name: "프로젝트 추가" }).click();
    await row("b.txt").waitFor();
    assert.deepEqual(await childNames(""), ["b.txt"]);

    await page.getByRole("tab", { name: "alpha" }).click();
    await row("src/main.ts").waitFor();
    assert.equal(await row("src").getAttribute("aria-expanded"), "true");
    await row("src").click();
    await row("src/main.ts").waitFor({ state: "detached" });
  });

  test("AC8 파일이 5,000개 든 폴더를 펼쳐도 1초 안에 표시되고 스크롤이 끊기지 않는다", async () => {
    mkdirSync(at("bulk"));
    for (let index = 0; index < 5000; index++) {
      writeFileSync(at(`bulk/file-${String(index).padStart(4, "0")}.txt`), "x");
    }
    await row("bulk").waitFor();

    const started = Date.now();
    await row("bulk").click();
    await row("bulk/file-0000.txt").waitFor();
    const shownIn = Date.now() - started;
    assert.ok(shownIn < 1000, `펼치는 데 ${shownIn}ms 걸림`);

    const frames = await tree().evaluate(async (element) => {
      const gaps = [];
      let last = performance.now();
      for (let frame = 0; frame < 90; frame++) {
        element.scrollTop += 700;
        await new Promise((next) => requestAnimationFrame(next));
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }
      return { average: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length, worst: Math.max(...gaps) };
    });
    console.log(`  펼치기 ${shownIn}ms, 스크롤 중 프레임 간격 평균 ${frames.average.toFixed(1)}ms, 최대 ${frames.worst.toFixed(1)}ms`);
    assert.ok(frames.average < 34, `스크롤 프레임 간격 평균 ${frames.average}ms`);
    assert.ok(frames.worst < 150, `스크롤 프레임 간격 최대 ${frames.worst}ms`);
    assert.ok((await page.locator("[role=treeitem]").count()) < 150, "보이는 줄만 그린다");

    await tree().evaluate((element) => { element.scrollTop = 0; });
    await row("bulk").click();
    await row("bulk/file-0000.txt").waitFor({ state: "detached" });
  });

  test("AC10 AC11 누르면 선택되고 Ctrl·Shift로 여러 개를 고르며, 화살표 키로 움직인다", async () => {
    await row("notes.txt").click();
    assert.deepEqual(await selected(), ["notes.txt"]);
    await row("Zeta.txt").click({ modifiers: ["Control"] });
    assert.deepEqual(await selected(), ["notes.txt", "Zeta.txt"]);
    await row("notes.txt").click();
    await row("Zeta.txt").click({ modifiers: ["Shift"] });
    assert.deepEqual(await selected(), ["notes.txt", "readme.md", "Zeta.txt"]);
    app.screenshot("AC10-multi-select.png");

    await row("docs").click();
    await row("docs/guide.md").waitFor();
    await page.keyboard.press("ArrowDown");
    assert.deepEqual(await selected(), ["docs/guide.md"]);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowLeft");
    await row("docs/guide.md").waitFor({ state: "detached" });
    await page.keyboard.press("ArrowRight");
    await row("docs/guide.md").waitFor();
    await page.keyboard.press("ArrowLeft");
    await row("docs/guide.md").waitFor({ state: "detached" });
  });

  test("AC12 AC13 끌어서 폴더에 놓으면 실제로 옮겨지고, 여러 개를 고르면 함께 옮겨진다", async () => {
    await seed("t12", { "inbox/": "", "a.txt": "A", "b.txt": "B", "c.txt": "C" });

    await row("t12/a.txt").dragTo(row("t12/inbox"));
    await waitUntil(() => exists("t12/inbox/a.txt"), "a.txt가 inbox로 옮겨짐");
    assert.equal(exists("t12/a.txt"), false);
    assert.equal(content("t12/inbox/a.txt"), "A");
    await row("t12/inbox/a.txt").waitFor();

    await row("t12/b.txt").click();
    await row("t12/c.txt").click({ modifiers: ["Control"] });
    await row("t12/c.txt").dragTo(row("t12/inbox"));
    await waitUntil(() => exists("t12/inbox/b.txt") && exists("t12/inbox/c.txt"), "b, c가 함께 옮겨짐");
    assert.deepEqual(readdirSync(at("t12")).sort(), ["inbox"]);
  });

  test("AC14 끄는 동안 놓을 폴더가 강조되고, 빈 곳에 놓으면 프로젝트 폴더 바로 아래로 옮겨진다", async () => {
    await seed("t14", { "target/": "", "move-me.txt": "M" });

    const from = await row("t14/move-me.txt").boundingBox();
    const over = await row("t14/target").boundingBox();
    await page.mouse.move(from.x + 60, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(over.x + 60, over.y + over.height / 2, { steps: 6 });
    await page.locator('[data-path="t14/target"].filerow--drop').waitFor();
    app.screenshot("AC14-drop-target-highlight.png");

    const treeBox = await tree().boundingBox();
    await page.mouse.move(treeBox.x + 60, treeBox.y + treeBox.height - 12, { steps: 6 });
    await page.locator(".filetree--drop").waitFor();
    assert.equal(await page.locator(".filerow--drop").count(), 0, "빈 곳에서는 폴더 줄이 강조되지 않는다");
    await page.mouse.up();

    await waitUntil(() => exists("move-me.txt"), "프로젝트 폴더 바로 아래로 옮겨짐");
    assert.equal(exists("t14/move-me.txt"), false);
    await row("move-me.txt").waitFor();
    rmSync(at("move-me.txt"));
  });

  test("AC15 같은 이름이 있으면 하나도 옮겨지지 않고 이유가 표시되며 두 파일 내용은 그대로다", async () => {
    await seed("t15", { "inbox/same.txt": "inside", "same.txt": "outside", "other.txt": "other" });

    await row("t15/other.txt").click();
    await row("t15/same.txt").click({ modifiers: ["Control"] });
    await row("t15/same.txt").dragTo(row("t15/inbox"));

    await note().waitFor();
    assert.match(await note().innerText(), /같은 이름이 이미 있어 옮기지 않았습니다/);
    assert.equal(content("t15/inbox/same.txt"), "inside");
    assert.equal(content("t15/same.txt"), "outside");
    assert.equal(exists("t15/other.txt"), true, "겹치지 않는 것도 옮겨지지 않는다");
    assert.equal(exists("t15/inbox/other.txt"), false);
    app.screenshot("AC15-name-taken-notice.png");
  });

  test("AC16 폴더를 자기 안의 폴더에 놓아도 아무것도 바뀌지 않는다", async () => {
    await seed("t16", { "outer/inner/deep.txt": "D" });
    await row("t16/outer").click();
    await row("t16/outer/inner").waitFor();

    await row("t16/outer").dragTo(row("t16/outer/inner"));
    await row("t16/outer").dragTo(row("t16/outer"));

    assert.equal(content("t16/outer/inner/deep.txt"), "D");
    assert.deepEqual(readdirSync(at("t16/outer/inner")), ["deep.txt"]);
    assert.deepEqual(await callCore("move", { items: ["t16/outer"], to: "t16/outer/inner" }), {
      status: 409,
      body: { error: "into_itself" },
    });
  });

  test("AC17 우클릭하면 기린 테마 메뉴가 뜨고, 빈 곳에서는 세 가지만 나오며, 밖을 누르거나 Esc로 닫힌다", async () => {
    await row("readme.md").click({ button: "right" });
    assert.deepEqual(await page.getByRole("menuitem").allInnerTexts(), [
      "새 파일", "새 폴더", "잘라내기", "복사", "붙여넣기", "이름 바꾸기", "지우기",
    ]);
    const colors = await page.locator(".menu").evaluate((menu) => {
      const style = getComputedStyle(menu);
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement("div");
      probe.style.color = root.getPropertyValue("--bg-3");
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: style.backgroundColor, expected };
    });
    assert.equal(colors.actual, colors.expected, "메뉴 바탕이 색상표의 색이다");
    app.screenshot("AC17-context-menu.png");

    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });

    const blank = await blankSpot();
    await page.mouse.click(blank.x, blank.y, { button: "right" });
    assert.deepEqual(await page.getByRole("menuitem").allInnerTexts(), ["새 파일", "새 폴더", "붙여넣기"]);
    await page.mouse.click(blank.x + 500, blank.y - 100);
    await page.getByRole("menu").waitFor({ state: "detached" });
  });

  test("AC18 AC19 이름 바꾸기: 메뉴나 F2로 그 자리에서 고치고, 겹치거나 못 쓰는 이름은 이유가 표시된다", async () => {
    await seed("t18", { "old.txt": "O", "taken.txt": "T" });

    await row("t18/old.txt").click({ button: "right" });
    await menuItem("이름 바꾸기").click();
    assert.equal(await page.getByRole("textbox", { name: "새 이름" }).inputValue(), "old.txt");
    app.screenshot("AC18-rename-input.png");
    await typeName("새 이름", "new.txt");
    await waitUntil(() => exists("t18/new.txt"), "이름이 바뀜");
    assert.equal(content("t18/new.txt"), "O");
    assert.equal(exists("t18/old.txt"), false);

    await row("t18/new.txt").click();
    await page.keyboard.press("F2");
    await page.getByRole("textbox", { name: "새 이름" }).fill("cancelled.txt");
    await page.keyboard.press("Escape");
    await page.locator(".filepane").getByRole("textbox").waitFor({ state: "detached" });
    assert.equal(exists("t18/new.txt"), true);

    await page.keyboard.press("F2");
    await typeName("새 이름", "taken.txt");
    await page.getByText("같은 이름이 이미 있어 이름을 바꾸지 않았습니다").waitFor();
    assert.equal(content("t18/taken.txt"), "T");
    assert.equal(content("t18/new.txt"), "O");

    for (const bad of ["a\\b", "a/b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b"]) {
      await row("t18/new.txt").click();
      await page.keyboard.press("F2");
      await typeName("새 이름", bad);
      await page.getByText("이 이름은 쓸 수 없습니다").waitFor();
      await page.getByRole("button", { name: "알림 닫기" }).click();
    }
    assert.deepEqual(readdirSync(at("t18")).sort(), ["new.txt", "taken.txt"]);
  });

  test("AC20 새 파일·새 폴더: 우클릭한 자리에 따라 만들 곳이 정해지고, 이름을 비우거나 Esc면 만들지 않는다", async () => {
    await seed("t20", { "sub/": "", "file.txt": "F" });

    await row("t20/sub").click({ button: "right" });
    await menuItem("새 파일").click();
    await typeName("새 파일 이름", "in-sub.ts");
    await waitUntil(() => exists("t20/sub/in-sub.ts"), "폴더 안에 새 파일");
    assert.equal(content("t20/sub/in-sub.ts"), "");

    await row("t20/file.txt").click({ button: "right" });
    await menuItem("새 폴더").click();
    await typeName("새 폴더 이름", "beside");
    await waitUntil(() => exists("t20/beside"), "파일이 있는 폴더에 새 폴더");

    const blank = await blankSpot();
    await page.mouse.click(blank.x, blank.y, { button: "right" });
    await menuItem("새 파일").click();
    await typeName("새 파일 이름", "at-root.txt");
    await waitUntil(() => exists("at-root.txt"), "프로젝트 폴더 바로 아래에 새 파일");

    const count = readdirSync(alpha).length;
    await page.mouse.click(blank.x, blank.y, { button: "right" });
    await menuItem("새 파일").click();
    await typeName("새 파일 이름", "");
    await page.locator(".filepane").getByRole("textbox").waitFor({ state: "detached" });
    await page.mouse.click(blank.x, blank.y, { button: "right" });
    await menuItem("새 폴더").click();
    await page.getByRole("textbox", { name: "새 폴더 이름" }).fill("never");
    await page.keyboard.press("Escape");
    await page.locator(".filepane").getByRole("textbox").waitFor({ state: "detached" });
    assert.equal(readdirSync(alpha).length, count);
    rmSync(at("at-root.txt"));
  });

  test("AC21 AC22 지우기: 확인 창을 거쳐 휴지통으로 가고, 취소하면 그대로다. 여러 개면 이름 바꾸기가 눌리지 않는다", async () => {
    await seed("t21", { "one.txt": "1", "two.txt": "2", "three.txt": "3", "dir/in.txt": "I" });

    await row("t21/one.txt").click();
    await page.keyboard.press("Delete");
    const dialog = page.getByRole("alertdialog", { name: "지우기 확인" });
    assert.equal(await dialog.locator(".dialog__text").innerText(), "one.txt을 휴지통으로 보냅니다");
    app.screenshot("AC21-trash-confirm.png");
    await dialog.getByRole("button", { name: "취소" }).click();
    assert.equal(exists("t21/one.txt"), true);

    await row("t21/one.txt").click({ button: "right" });
    await menuItem("지우기").click();
    await dialog.getByRole("button", { name: "확인" }).click();
    await waitUntil(() => !exists("t21/one.txt"), "one.txt가 지워짐");
    await row("t21/one.txt").waitFor({ state: "detached" });
    assert.equal(readdirSync(sandbox.trashDir).some((name) => name.endsWith("one.txt")), true, "휴지통으로 갔다");

    await row("t21/dir").click();
    await row("t21/two.txt").click({ modifiers: ["Control"] });
    await row("t21/two.txt").click({ button: "right" });
    assert.equal(await menuItem("이름 바꾸기").isDisabled(), true);
    await menuItem("지우기").click();
    assert.equal(await dialog.locator(".dialog__text").innerText(), "2개를 휴지통으로 보냅니다");
    await dialog.getByRole("button", { name: "확인" }).click();
    await waitUntil(() => !exists("t21/two.txt") && !exists("t21/dir"), "두 개가 지워짐");
    assert.deepEqual(readdirSync(at("t21")), ["three.txt"]);
  });

  test("AC23 AC24 Ctrl+Z로 옮기기·이름 바꾸기·새로 만들기·붙여넣기를 차례로 되돌린다", async () => {
    await seed("t23", { "box/": "", "a.txt": "A", "b.txt": "B" });
    const snapshot = () => JSON.stringify([readdirSync(at("t23")).sort(), readdirSync(at("t23/box")).sort()]);
    const initial = snapshot();

    await row("t23/a.txt").click();
    await row("t23/b.txt").click({ modifiers: ["Control"] });
    await row("t23/b.txt").dragTo(row("t23/box"));
    await waitUntil(() => exists("t23/box/a.txt") && exists("t23/box/b.txt"), "두 개를 옮김");

    await row("t23/box/a.txt").click();
    await page.keyboard.press("F2");
    await typeName("새 이름", "renamed.txt");
    await waitUntil(() => exists("t23/box/renamed.txt"), "이름을 바꿈");

    await row("t23/box").click({ button: "right" });
    await menuItem("새 파일").click();
    await typeName("새 파일 이름", "made.txt");
    await waitUntil(() => exists("t23/box/made.txt"), "새로 만듦");

    await row("t23/box/b.txt").click();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await waitUntil(() => exists("t23/box/b - 복사본.txt"), "붙여넣음");

    await page.keyboard.press("Control+z");
    await page.getByText("되돌림: b - 복사본.txt를 붙여넣은 것").waitFor();
    assert.equal(exists("t23/box/b - 복사본.txt"), false);

    await page.keyboard.press("Control+z");
    await page.getByText("되돌림: made.txt를 새로 만든 것").waitFor();
    assert.equal(exists("t23/box/made.txt"), false);

    await page.keyboard.press("Control+z");
    await page.getByText("되돌림: a.txt의 이름을 renamed.txt로 바꾼 것").waitFor();
    assert.equal(exists("t23/box/a.txt"), true);
    app.screenshot("AC24-undo-notice.png");

    await page.keyboard.press("Control+z");
    await page.getByText("되돌림: a.txt 외 1개를 box로 옮긴 것").waitFor();
    assert.equal(snapshot(), initial, "처음 상태와 같다");
    assert.equal(content("t23/a.txt"), "A");
  });

  test("AC24 AC25 되돌릴 수 없게 됐으면 아무것도 바꾸지 않고 이유를 알리고, 더 없으면 없다고 알린다", async () => {
    // 앞 테스트에서 되돌린 뒤의 기록을 비운다
    for (;;) {
      await row("notes.txt").click();
      await page.keyboard.press("Control+z");
      await note().waitFor();
      if ((await note().innerText()).includes("되돌릴 것이 없습니다")) break;
      await page.getByRole("button", { name: "알림 닫기" }).click();
    }

    await seed("t25", { "box/": "", "a.txt": "A", "gone.txt": "G" });
    await row("t25/gone.txt").click();
    await page.keyboard.press("F2");
    await typeName("새 이름", "gone2.txt");
    await waitUntil(() => exists("t25/gone2.txt"), "이름을 바꿈");
    await row("t25/a.txt").dragTo(row("t25/box"));
    await waitUntil(() => exists("t25/box/a.txt"), "옮김");

    put("t25/a.txt", "newer");
    rmSync(at("t25/gone2.txt"));
    await row("t25/gone2.txt").waitFor({ state: "detached" });

    await row("t25/box").click();
    await page.keyboard.press("Control+z");
    await page.getByText("되돌리지 못했습니다: 원래 자리에 같은 이름이 생겼습니다").waitFor();
    assert.equal(content("t25/a.txt"), "newer");
    assert.equal(content("t25/box/a.txt"), "A");

    await page.keyboard.press("Control+z");
    await page.getByText("되돌리지 못했습니다: 파일이 없어졌습니다").waitFor();

    await page.keyboard.press("Control+z");
    await page.getByText("되돌릴 것이 없습니다").waitFor();
  });

  test("AC26 다른 프로그램이 쓰는 파일은 옮기기·이름 바꾸기·지우기가 되지 않고 이유가 표시된다", async () => {
    await seed("t26", { "box/": "", "busy.txt": "BUSY" });
    const release = await lockFile(at("t26/busy.txt"));
    try {
      await row("t26/busy.txt").dragTo(row("t26/box"));
      await page.getByText("옮기기를 하지 못했습니다: 다른 프로그램이 쓰고 있는 파일이 있습니다").waitFor();
      app.screenshot("AC26-in-use-notice.png");

      await row("t26/busy.txt").click();
      await page.keyboard.press("F2");
      await typeName("새 이름", "renamed.txt");
      await page.getByText("이름 바꾸기를 하지 못했습니다: 다른 프로그램이 쓰고 있는 파일이 있습니다").waitFor();

      await row("t26/busy.txt").click();
      await page.keyboard.press("Delete");
      await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();
      await page.getByText("지우기를 하지 못했습니다: 다른 프로그램이 쓰고 있는 파일이 있습니다").waitFor();

      assert.deepEqual(readdirSync(at("t26")).sort(), ["box", "busy.txt"]);
      assert.deepEqual(readdirSync(at("t26/box")), []);
    } finally {
      await release();
    }
    assert.equal(content("t26/busy.txt"), "BUSY");
  });

  test("AC27 프로젝트 폴더 밖의 파일은 읽히지도 옮겨지지도 지워지지도 않는다", async () => {
    const absolute = join(outside, "secret.txt").replaceAll("\\", "/");
    for (const unsafe of ["../outside/secret.txt", "../outside", "..", absolute, "t26/../../outside", "..\\outside\\secret.txt", ".git/config"]) {
      for (const [action, body] of [
        ["list", { dirs: [unsafe] }],
        ["move", { items: [unsafe], to: "" }],
        ["move", { items: ["readme.md"], to: unsafe }],
        ["copy", { items: [unsafe], to: "" }],
        ["copy", { items: ["readme.md"], to: unsafe }],
        ["rename", { path: unsafe, name: "x.txt" }],
        ["create", { parent: unsafe, name: "x.txt", kind: "file" }],
        ["trash", { items: [unsafe] }],
      ]) {
        const reply = await callCore(action, body);
        assert.equal(reply.status, 400, `${action} ${JSON.stringify(body)}`);
      }
    }
    assert.equal((await callCore("rename", { path: "readme.md", name: "..\\..\\outside\\x.md" })).status, 400);

    assert.deepEqual(readdirSync(outside), ["secret.txt"]);
    assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "secret");
    assert.equal(content("readme.md"), "readme");
    assert.equal(content(".git/config"), "git");
  });

  test("AC29 AC31 AC32 복사·붙여넣기: 사본이 생기고, 붙여넣을 곳이 선택에 따라 정해지며, 겹치면 복사본 이름이 된다", async () => {
    await seed("t29", { "dest/keep.txt": "K", "pack/inner/deep.txt": "D", "one.txt": "1" });

    await row("t29/one.txt").click();
    await page.keyboard.press("Control+c");
    await row("t29/dest").click();
    await page.keyboard.press("Control+v");
    await waitUntil(() => exists("t29/dest/one.txt"), "폴더를 선택하고 붙여넣으면 그 폴더 안에");
    assert.equal(content("t29/dest/one.txt"), "1");
    assert.equal(content("t29/one.txt"), "1", "원래 것은 남는다");

    await row("t29/pack").click({ button: "right" });
    await menuItem("복사").click();
    await row("t29/dest/keep.txt").click({ button: "right" });
    await menuItem("붙여넣기").click();
    await waitUntil(() => exists("t29/dest/pack/inner/deep.txt"), "파일을 가리키면 그 파일이 있는 폴더에, 폴더는 안의 내용까지");
    assert.equal(content("t29/dest/pack/inner/deep.txt"), "D");

    await row("t29/one.txt").click();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await waitUntil(() => exists("t29/one - 복사본.txt"), "같은 폴더에 붙여넣으면 복사본 이름");
    await row("t29/one.txt").click();
    await page.keyboard.press("Control+v");
    await waitUntil(() => exists("t29/one - 복사본 (2).txt"), "복사본도 있으면 번호가 붙는다");
    assert.equal(content("t29/one.txt"), "1");
    assert.equal(content("t29/one - 복사본.txt"), "1");
    app.screenshot("AC32-copy-names.png");
  });

  test("AC30 AC33 잘라내기: 흐리게 표시되고 붙여넣으면 옮겨지며, Esc로 취소되고, 겹치면 옮겨지지 않는다", async () => {
    await seed("t30", { "dest/clash.txt": "inside", "clash.txt": "outside", "go.txt": "GO", "stay.txt": "STAY" });

    await row("t30/stay.txt").click();
    await page.keyboard.press("Control+x");
    await page.locator('[data-path="t30/stay.txt"].filerow--cut').waitFor();
    app.screenshot("AC30-cut-dimmed.png");
    await page.keyboard.press("Escape");
    await page.locator('[data-path="t30/stay.txt"].filerow--cut').waitFor({ state: "detached" });
    await row("t30/dest").click();
    await page.keyboard.press("Control+v");
    assert.equal(exists("t30/stay.txt"), true, "Esc 뒤에는 붙여넣어도 옮겨지지 않는다");

    await row("t30/go.txt").click();
    await page.keyboard.press("Control+x");
    await row("t30/dest").click();
    await page.keyboard.press("Control+v");
    await waitUntil(() => exists("t30/dest/go.txt"), "붙여넣으면 옮겨짐");
    assert.equal(exists("t30/go.txt"), false);
    await page.locator(".filerow--cut").waitFor({ state: "detached" });

    await row("t30/clash.txt").click();
    await page.keyboard.press("Control+x");
    await row("t30/dest").click();
    await page.keyboard.press("Control+v");
    await page.getByText("같은 이름이 이미 있어 옮기지 않았습니다").waitFor();
    assert.equal(content("t30/dest/clash.txt"), "inside");
    assert.equal(content("t30/clash.txt"), "outside");
    await page.keyboard.press("Escape");
  });

  test("AC34 복사한 것이 없으면 붙여넣기가 눌리지 않고, 폴더를 자기 안에 붙여넣을 수 없다", async () => {
    await seed("t34", { "outer/inner/": "" });
    await row("t34/outer").click();
    await row("t34/outer/inner").waitFor();

    await row("t34/outer").click({ button: "right" });
    assert.equal(await menuItem("붙여넣기").isDisabled(), true);
    await menuItem("복사").click();

    await row("t34/outer/inner").click();
    await page.keyboard.press("Control+v");
    await page.getByText("폴더를 자기 자신 안에는 붙여넣을 수 없습니다").waitFor();
    assert.deepEqual(readdirSync(at("t34/outer/inner")), []);
  });

  test("AC35 붙여넣기가 1초 넘게 걸리면 복사하는 중이 표시되고, 그동안에도 앱이 멈추지 않는다", async () => {
    await row("bulk").click({ button: "right" });
    await menuItem("복사").click();
    const blank = await blankSpot();
    await page.mouse.click(blank.x, blank.y, { button: "right" });
    const started = Date.now();
    await menuItem("붙여넣기").click();

    const busy = page.locator(".filenote--busy");
    await busy.waitFor({ state: "attached" });
    assert.equal(await busy.isVisible(), false, "1초가 되기 전에는 보이지 않는다");
    await busy.waitFor({ state: "visible", timeout: 20000 });
    const shownAfter = Date.now() - started;
    assert.ok(shownAfter >= 900, `복사하는 중이 ${shownAfter}ms 만에 보임`);
    assert.equal(await busy.innerText(), "복사하는 중");
    app.screenshot("AC35-copying.png");

    // 복사 중에도 화면이 입력을 받고 코어가 다른 요청에 답한다
    await row("notes.txt").click();
    assert.deepEqual(await selected(), ["notes.txt"]);
    assert.equal((await callCore("list", { dirs: [""] })).status, 200);
    assert.equal(await busy.count(), 1, "아직 복사 중이다");

    await busy.waitFor({ state: "detached", timeout: 120000 });
    console.log(`  5,000개 복사에 ${Date.now() - started}ms`);
    assert.equal(readdirSync(at("bulk - 복사본")).length, 5000);
    await row("bulk - 복사본").waitFor();
  });

  test("AC9 프로젝트 폴더가 없어지면 파일 칸에 폴더를 찾을 수 없다고 표시된다", async () => {
    await page.getByRole("tab", { name: "beta" }).click();
    await row("b.txt").waitFor();
    // 그 폴더에서 떠 있는 터미널이 있으면 Windows가 폴더를 지우지 못하게 막는다. 터미널을 먼저 닫는다
    await page.locator(".agentrow__close").click();
    await page.locator(".agentrow").waitFor({ state: "detached" });
    rmSync(beta, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });

    const pane = page.getByRole("region", { name: "파일 칸" });
    await pane.getByText("폴더를 찾을 수 없습니다").waitFor({ timeout: 5000 });
    assert.equal(await tree().count(), 0);
    app.screenshot("AC9-folder-missing.png");
    await page.getByRole("tab", { name: "alpha" }).click();
    await row("readme.md").waitFor();
  });
});
