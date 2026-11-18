// 실제 앱 창과 실제 파일로 문서 창의 인수 기준을 확인한다. 실행: npm run e2e (먼저 앱을 빌드해야 한다)
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

// PowerShell은 넣은 명령을 사용자의 명령 기록 파일에 남긴다. 그래서 명령 프롬프트로 띄운다
const CMD_ONLY = { VA_HIDE_SHELLS: "pwsh" };
const NARROWEST = 240;

const README = `# 프로젝트 안내

본문 **굵게** 그리고 \`코드\`. [계획 보기](docs/plan.md) · [바깥 링크](https://example.com/)

- 하나
- 둘

- [ ] 할 일
- [x] 한 일

> 인용한 글

| 이름 | 값 |
|---|---|
| a | 1 |

\`\`\`ts
const x = 1;
\`\`\`
`;

const DIAGRAM = `# 흐름

\`\`\`mermaid
graph TD
  A[명세] --> B[승인]
  B --> C[구현]
\`\`\`

\`\`\`mermaid
this is not a diagram ->>> ???
\`\`\`
`;

describe("문서 창", () => {
  let sandbox;
  let app;
  let page;
  let alpha;
  let beta;

  const file = (name) => page.locator(`[role="treeitem"][aria-label="${name}"]`);
  const pane = () => page.locator('section[aria-label="문서 창"]');
  const tabNames = () => page.locator('[aria-label="문서 탭"] [role="tab"]').allInnerTexts();
  const selectedTab = () => page.locator('[aria-label="문서 탭"] [role="tab"][aria-selected="true"]').innerText();
  const lines = () => page.locator(".doc__line").allInnerTexts();
  const box = (selector) => page.locator(selector).boundingBox();
  const boundary = () => page.getByRole("separator", { name: "문서 창 너비 조절" });
  const termText = () => page.locator(".termview .xterm-rows").innerText();
  const waitTerm = (part) => waitUntil(async () => (await termText()).includes(part), `터미널에 "${part}"가 보임`);
  const run = async (command) => {
    await page.locator(".termview").click();
    await page.keyboard.type(command);
    await page.keyboard.press("Enter");
  };
  /** 터미널이 지금 쓰는 가로 글자 수 */
  const terminalColumns = async (mark) => {
    await run(`echo ${mark}& mode con`);
    let columns = 0;
    await waitUntil(async () => {
      const text = await termText();
      const after = text.slice(text.lastIndexOf(mark));
      const match = /(?:Columns|열):\s*(\d+)/.exec(after);
      columns = match ? Number(match[1]) : 0;
      return columns > 0;
    }, "터미널의 가로 글자 수가 보임");
    return columns;
  };
  const dragBoundaryTo = async (x) => {
    const doc = await box('section[aria-label="문서 창"]');
    const y = doc.y + doc.height / 2;
    await page.mouse.move(doc.x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 8 });
    await page.mouse.up();
  };

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    beta = sandbox.project("beta");
    mkdirSync(join(alpha, "docs"));
    writeFileSync(join(alpha, "readme.md"), README);
    writeFileSync(join(alpha, "diagram.md"), DIAGRAM);
    writeFileSync(join(alpha, "docs", "plan.md"), "# 계획 문서\n\n연결된 문서입니다.\n");
    writeFileSync(join(alpha, "notes.txt"), "첫 줄 한글\nsecond line\n\n    들여쓴 줄\n");
    writeFileSync(join(alpha, "long.log"), Array.from({ length: 400 }, (_, index) => `line-${index + 1}`).join("\n") + "\n");
    writeFileSync(join(alpha, "page.html"), '<h1 id="t">처음 제목</h1><script>document.getElementById("t").textContent = "스크립트가 바꿈"</script>');
    writeFileSync(join(alpha, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
    writeFileSync(join(alpha, "big.log"), "x".repeat(1024 * 1024 + 1));
    writeFileSync(join(beta, "b.md"), "# 베타 문서\n");
    sandbox.seedSettings([alpha, beta]);
    app = await launchApp(sandbox, CMD_ONLY);
    page = app.page;
    page.setDefaultTimeout(8000);
    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 1280, 820);
    await page.getByRole("tab", { name: "alpha" }).click();
    await file("readme.md").waitFor();
    await waitTerm(">");
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC17 문서 창을 열기 전에는 문서 창이 없고, 머메이드 그리기 부품을 읽어 들이지 않았다", async () => {
    assert.equal(await pane().count(), 0);
    const loaded = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /mermaid/i.test(name)));
    assert.deepEqual(loaded, []);
  });

  test("AC1 AC2 파일을 누르면 1초 안에 터미널 오른쪽에 문서 창이 열리고, 마크다운이 그려져 보인다", async () => {
    const full = await box(".termview");
    await file("readme.md").click();
    await waitUntil(async () => (await pane().locator("h1").count()) === 1, "문서 창에 제목이 그려짐", 1000);
    assert.equal(await pane().locator("h1").innerText(), "프로젝트 안내");
    assert.deepEqual(await tabNames(), ["readme.md"]);
    assert.equal(await pane().locator("strong").innerText(), "굵게");
    assert.equal(await pane().locator("li").count(), 4);
    assert.equal(await pane().locator('input[type="checkbox"]').count(), 2);
    assert.equal(await pane().locator("table td").count(), 2);
    assert.equal(await pane().locator("blockquote").innerText(), "인용한 글");
    assert.equal(await pane().locator("pre code").innerText(), "const x = 1;\n");

    // 터미널은 왼쪽에 그대로 있고, 문서 창은 그 오른쪽에 있다
    const term = await box(".termview");
    const doc = await box('section[aria-label="문서 창"]');
    assert.ok(term.width < full.width - 200, "터미널이 자리를 내어 줌");
    assert.ok(doc.x >= term.x + term.width - 1, "문서 창이 터미널 오른쪽에 있음");
    assert.ok(Math.abs(doc.width - (term.width + doc.width) / 2) < 8, "처음에는 반반");
    app.screenshot("AC1-AC2-markdown-document.png");
  });

  test("AC1 AC10 문서 창이 열려 있어도 터미널을 계속 쓸 수 있고, 터미널은 좁아진 자리에 다시 맞춰져 있다", async () => {
    const columns = await terminalColumns("cols-with-doc");
    const term = await box(".termview");
    // 글자 한 칸은 8px쯤이다. 터미널 너비에 들어가는 글자 수와 맞아야 한다
    assert.ok(columns < term.width / 6 && columns > term.width / 10, `가로 ${columns}칸이 너비 ${term.width}px에 맞음`);
  });

  test("AC6 원문 버튼으로 그려진 모습과 파일에 적힌 글자를 오간다", async () => {
    const raw = page.getByRole("button", { name: "원문" });
    await raw.click();
    assert.equal((await lines())[0], "# 프로젝트 안내");
    assert.equal(await pane().locator("h1").count(), 0);
    assert.equal(await raw.getAttribute("aria-pressed"), "true");
    await raw.click();
    assert.equal(await pane().locator("h1").count(), 1);
  });

  test("AC14 프로젝트 안의 파일을 가리키는 링크를 누르면 그 파일이 열리고, 웹 주소 링크는 눌러도 앱 화면이 그대로다", async () => {
    const address = page.url();
    await pane().getByRole("link", { name: "바깥 링크" }).click();
    await page.waitForTimeout(300);
    assert.equal(page.url(), address);
    assert.deepEqual(await tabNames(), ["readme.md"]);

    await pane().getByRole("link", { name: "계획 보기" }).click();
    await waitUntil(async () => (await pane().locator("h1").innerText().catch(() => "")) === "계획 문서", "연결된 문서가 열림");
    assert.deepEqual(await tabNames(), ["readme.md", "plan.md"]);
    assert.equal(await selectedTab(), "plan.md");
  });

  test("AC5 글자 파일은 글자 폭이 같은 글꼴로 줄 번호와 함께 그대로 보이고, 한글이 깨지지 않는다", async () => {
    await file("notes.txt").click();
    await waitUntil(async () => (await lines()).length === 4, "네 줄이 보임");
    const shown = await page.locator(".doc__line").evaluateAll((items) => items.map((item) => item.textContent));
    assert.deepEqual(shown, ["첫 줄 한글", "second line", "\n", "    들여쓴 줄"]);
    const style = await page.locator(".doc__line").nth(1).evaluate((line) => ({
      font: getComputedStyle(line).fontFamily,
      number: getComputedStyle(line, "::before").content,
      numberWidth: getComputedStyle(line, "::before").width,
    }));
    assert.match(style.font, /Mono|Consolas|monospace/);
    assert.match(style.number, /counter\(line\)|"2"/);
    assert.equal(style.numberWidth, "44px");
    assert.equal(await page.getByRole("button", { name: "원문" }).count(), 0);
    app.screenshot("AC5-text-document.png");
  });

  test("AC8 연 파일마다 문서 탭이 생기고, 이미 연 파일을 다시 누르면 새 탭 없이 그 탭이 보인다", async () => {
    assert.deepEqual(await tabNames(), ["readme.md", "plan.md", "notes.txt"]);
    await file("readme.md").click();
    assert.deepEqual(await tabNames(), ["readme.md", "plan.md", "notes.txt"]);
    assert.equal(await selectedTab(), "readme.md");
    await page.locator('[aria-label="문서 탭"] [role="tab"]', { hasText: "notes.txt" }).click();
    assert.equal(await selectedTab(), "notes.txt");
    assert.equal((await lines()).length, 4);
  });

  test("AC7 열어 둔 파일을 다른 프로그램이 고치면 2초 안에 내용이 따라 바뀌고, 읽던 위치가 유지된다", async () => {
    await file("long.log").click();
    await waitUntil(async () => (await lines()).length === 400, "400줄이 보임");
    await page.locator(".doc").evaluate((element) => {
      element.scrollTop = 3000;
    });
    const before = await page.locator(".doc").evaluate((element) => element.scrollTop);
    assert.equal(before, 3000);

    writeFileSync(join(alpha, "long.log"), Array.from({ length: 420 }, (_, index) => `changed-${index + 1}`).join("\n") + "\n");
    await waitUntil(async () => (await page.locator(".doc__line").first().textContent()) === "changed-1", "바뀐 내용이 보임", 2000);
    assert.equal((await lines()).length, 420);
    assert.equal(await page.locator(".doc").evaluate((element) => element.scrollTop), 3000);
  });

  test("AC12 열어 둔 파일이 지워지면 2초 안에 찾을 수 없다고 알리고, 다시 생기면 내용이 보인다", async () => {
    rmSync(join(alpha, "long.log"));
    await waitUntil(async () => (await pane().getByRole("alert").innerText().catch(() => "")) === "파일을 찾을 수 없습니다", "찾을 수 없다고 알림", 2000);
    writeFileSync(join(alpha, "long.log"), "back\n");
    await waitUntil(async () => (await lines()).join("|") === "back", "다시 생긴 내용이 보임", 2000);
  });

  test("AC3 AC17 머메이드 그림은 그림으로 그려지고, 그릴 수 없는 것은 원래 글자와 알림이 보인다. 부품은 이때 읽어 들인다", async () => {
    await file("diagram.md").click();
    await waitUntil(async () => (await pane().locator(".doc__diagram svg").count()) === 1, "머메이드 그림이 그려짐", 15000);
    const svg = await pane().locator(".doc__diagram svg").evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      text: element.textContent,
    }));
    assert.ok(svg.width > 50, "그림에 크기가 있음");
    for (const label of ["명세", "승인", "구현"]) assert.ok(svg.text.includes(label), `그림에 "${label}"이 있음`);
    await waitUntil(async () => (await pane().locator(".doc__diagram-error").count()) === 1, "그리지 못했다고 알림");
    assert.equal(await pane().locator(".doc__diagram-error").innerText(), "그림을 그리지 못했습니다");
    assert.ok((await pane().locator("pre code.language-mermaid").innerText()).includes("this is not a diagram"));
    // 그리지 못한 그림의 찌꺼기가 화면 다른 곳에 남지 않는다
    assert.equal(await page.locator("body > [id^='ddoc-diagram'], body > svg").count(), 0);
    const loaded = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => /mermaid/i.test(entry.name)).length);
    assert.ok(loaded > 0, "머메이드 부품을 이때 읽어 들임");
    app.screenshot("AC3-mermaid-diagram.png");
  });

  test("AC4 HTML 파일은 그려진 모습으로 보이고, 그 안의 스크립트는 실행되지 않는다", async () => {
    await file("page.html").click();
    const frame = page.frameLocator("iframe.doc__html");
    await waitUntil(async () => (await frame.locator("h1").innerText().catch(() => "")) !== "", "HTML 문서가 그려짐");
    await page.waitForTimeout(500);
    assert.equal(await frame.locator("h1").innerText(), "처음 제목");
    assert.equal(await page.locator("iframe.doc__html").getAttribute("sandbox"), "");
    await page.getByRole("button", { name: "원문" }).click();
    assert.ok((await lines())[0].startsWith('<h1 id="t">처음 제목</h1>'));
  });

  test("AC11 글자 파일이 아닌 것과 너무 큰 파일은 내용 대신 이유가 보인다", async () => {
    await file("image.png").click();
    await waitUntil(async () => (await pane().getByRole("alert").innerText().catch(() => "")) === "글자 파일이 아니어서 보여 줄 수 없습니다", "글자 파일이 아니라고 알림");
    await file("big.log").click();
    await waitUntil(async () => (await pane().getByRole("alert").innerText().catch(() => "")) === "파일이 너무 커서 열지 않았습니다 (1MB 초과)", "너무 크다고 알림");
  });

  test("AC10 문서 경계를 끌면 너비가 나뉘고, 어느 쪽도 240px보다 좁아지지 않는다", async () => {
    await page.locator('[aria-label="문서 탭"] [role="tab"]', { hasText: "notes.txt" }).click();
    const split = await box(".worksplit");
    assert.equal(await boundary().evaluate((element) => getComputedStyle(element).cursor), "col-resize");

    await dragBoundaryTo(split.x + split.width - 400);
    let doc = await box('section[aria-label="문서 창"]');
    assert.ok(Math.abs(doc.width - 400) <= 2, `문서 창 400px (실제 ${doc.width})`);
    let term = await box(".worksplit__main");
    assert.ok(Math.abs(term.width + doc.width - split.width) <= 2, "둘의 합은 그대로");

    await dragBoundaryTo(split.x + split.width + 300);
    doc = await box('section[aria-label="문서 창"]');
    assert.ok(Math.abs(doc.width - NARROWEST) <= 2, `문서 창은 240px에서 멈춤 (실제 ${doc.width})`);

    await dragBoundaryTo(split.x - 300);
    term = await box(".worksplit__main");
    assert.ok(Math.abs(term.width - NARROWEST) <= 2, `터미널은 240px에서 멈춤 (실제 ${term.width})`);
    assert.equal(await page.evaluate(() => String(getSelection())), "", "끄는 동안 글자가 선택되지 않음");
    app.screenshot("AC10-narrowest-terminal.png");
  });

  test("AC10 방향키로 조금씩 움직이고, 더블클릭하면 반반으로 돌아가며, 터미널이 다시 맞춰진다", async () => {
    const narrow = await terminalColumns("cols-narrow");
    const before = await box('section[aria-label="문서 창"]');
    await boundary().focus();
    await page.keyboard.press("ArrowRight");
    let doc = await box('section[aria-label="문서 창"]');
    assert.ok(Math.abs(before.width - doc.width - 16) <= 2, "오른쪽 키로 문서 창이 16px 좁아짐");
    await page.keyboard.press("ArrowLeft");
    doc = await box('section[aria-label="문서 창"]');
    assert.ok(Math.abs(before.width - doc.width) <= 2, "왼쪽 키로 되돌아옴");

    await page.mouse.dblclick(doc.x, doc.y + doc.height / 2);
    const split = await box(".worksplit");
    await waitUntil(async () => Math.abs((await box('section[aria-label="문서 창"]')).width - split.width / 2) <= 2, "반반으로 돌아감");
    const wide = await terminalColumns("cols-half");
    assert.ok(wide > narrow + 10, `터미널이 넓어진 자리에 다시 맞춰짐 (${narrow}칸 → ${wide}칸)`);
  });

  test("AC13 프로젝트 탭마다 열어 둔 문서가 따로이고, 돌아오면 보던 문서 탭이 그대로다", async () => {
    const opened = await tabNames();
    const selected = await selectedTab();
    await page.getByRole("tab", { name: "beta" }).click();
    await file("b.md").waitFor();
    assert.equal(await pane().count(), 0);
    await file("b.md").click();
    await waitUntil(async () => (await pane().locator("h1").innerText().catch(() => "")) === "베타 문서", "베타의 문서가 열림");
    assert.deepEqual(await tabNames(), ["b.md"]);

    await page.getByRole("tab", { name: "alpha" }).click();
    await waitUntil(async () => JSON.stringify(await tabNames()) === JSON.stringify(opened), "알파의 문서 탭이 그대로임");
    assert.equal(await selectedTab(), selected);
  });

  test("AC16 파일 칸의 선택과 Ctrl 누른 채 누르기는 그대로이고, 그때는 문서가 열리지 않는다", async () => {
    const opened = await tabNames();
    await file("docs").click({ modifiers: ["Control"] });
    await file("image.png").click({ modifiers: ["Control"] });
    assert.equal(await file("image.png").getAttribute("aria-selected"), "true");
    assert.equal(await file("docs").getAttribute("aria-selected"), "true");
    assert.deepEqual(await tabNames(), opened);
  });

  test("AC9 문서 탭의 ×로 닫고, 마지막 문서를 닫으면 문서 창이 사라져 터미널이 작업 영역 전체를 쓴다", async () => {
    let names = await tabNames();
    while (names.length > 1) {
      await page.getByRole("button", { name: `${names[0]} 문서 닫기`, exact: true }).click();
      const next = await tabNames();
      assert.equal(next.length, names.length - 1);
      names = next;
    }
    await page.getByRole("button", { name: `${names[0]} 문서 닫기`, exact: true }).click();
    await waitUntil(async () => (await pane().count()) === 0, "문서 창이 사라짐");
    assert.equal(await boundary().count(), 0);
    const split = await box(".worksplit");
    const term = await box(".termview");
    assert.ok(Math.abs(term.width - split.width) <= 1, "터미널이 작업 영역 전체를 씀");
  });
});
