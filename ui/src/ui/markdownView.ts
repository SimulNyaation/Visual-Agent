// 마크다운을 그린다. 공개 부품 markdown-it으로 HTML을 만들고, 머메이드 그림은 필요할 때만 부품을 읽어 들여 그린다.
import MarkdownIt from "markdown-it";

// 문서 안에 적힌 HTML 태그는 그리지 않고 글자로 보여 준다 (문서가 앱 화면을 바꾸거나 스크립트를 실행하지 못하게)
const markdown = new MarkdownIt({ html: false, linkify: true });

// 그림은 보여 주지 않고 설명 글자만 남긴다
markdown.renderer.rules.image = (tokens, index) => {
  const alt = tokens[index]?.content ?? "";
  return `<span class="doc__image">[그림${alt ? `: ${markdown.utils.escapeHtml(alt)}` : ""}]</span>`;
};

/** 마크다운 원문을 화면에 넣을 HTML로 바꾼다 */
export function renderMarkdown(text: string): string {
  return (
    markdown
      .render(text)
      // 체크 목록: "- [ ] 할 일", "- [x] 한 일"
      .replace(/<li>(\s*(?:<p>)?)\[([ xX])\] /g, (_match, lead: string, mark: string) => {
        const checked = mark === " " ? "" : " checked";
        return `<li class="doc__task">${lead}<input type="checkbox" disabled${checked}> `;
      })
  );
}

/** 색은 색상표(design/theme-kirin.css)의 토큰에서 읽는다 */
function diagramTheme() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    darkMode: true,
    background: token("--bg-1"),
    primaryColor: token("--bg-3"),
    primaryTextColor: token("--text-1"),
    primaryBorderColor: token("--ochre"),
    secondaryColor: token("--bg-2"),
    tertiaryColor: token("--bg-2"),
    lineColor: token("--text-2"),
    textColor: token("--text-1"),
    fontFamily: style.fontFamily,
  };
}

type Mermaid = (typeof import("mermaid"))["default"];
let loading: Promise<Mermaid> | null = null;
let drawn = 0;

/** 머메이드 그리기 부품. 처음 필요할 때 한 번만 읽어 들인다 */
function loadMermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then((module) => {
    module.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // 그리지 못했을 때 부품이 제 오류 그림을 화면에 넣지 않게 한다 (알림은 우리가 붙인다)
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: diagramTheme(),
    });
    return module.default;
  });
  return loading;
}

/** 그려 넣은 마크다운 안의 머메이드 코드를 그림으로 바꾼다. 그릴 수 없으면 원래 글자 아래에 알림을 붙인다 */
export async function drawDiagrams(host: HTMLElement): Promise<void> {
  const blocks = [...host.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  if (blocks.length === 0) return;
  let mermaid: Mermaid | null = null;
  try {
    mermaid = await loadMermaid();
  } catch {
    // 부품을 읽어 들이지 못했다. 아래에서 그리지 못한 것으로 알린다
  }
  for (const code of blocks) {
    const block = code.parentElement;
    if (!block?.isConnected) continue;
    const id = `doc-diagram-${++drawn}`;
    try {
      if (!mermaid) throw new Error("mermaid unavailable");
      const { svg } = await mermaid.render(id, code.textContent ?? "");
      const figure = document.createElement("div");
      figure.className = "doc__diagram";
      figure.setAttribute("role", "img");
      figure.setAttribute("aria-label", "머메이드 그림");
      figure.innerHTML = svg;
      block.replaceWith(figure);
    } catch {
      // 그리다 만 것이 화면 어딘가에 남아 있으면 치운다
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      const note = document.createElement("p");
      note.className = "doc__diagram-error";
      note.textContent = "그림을 그리지 못했습니다";
      block.after(note);
    }
  }
}
