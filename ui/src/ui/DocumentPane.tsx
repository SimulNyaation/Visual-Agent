// 문서 창. 열어 둔 문서마다 문서 탭이 하나씩 있고, 보고 있는 문서의 내용을 읽기 전용으로 보여 준다.
import type { MouseEvent } from "react";
import { documentErrorMessage, resolveLink, type OpenDocument } from "../domain/documents";
import { drawDiagrams, renderMarkdown } from "./markdownView";

interface Props {
  documents: OpenDocument[];
  activePath: string | null;
  /** 문서 창이 작업 영역에서 차지하는 몫 (0~1) */
  share: number;
  onSelect(path: string): void;
  onClose(path: string): void;
  onToggleRaw(path: string): void;
  /** 문서 안의 링크가 가리키는 프로젝트 안의 파일을 연다 */
  onOpen(path: string): void;
}

/** 글자 그대로 보여 준다. 줄 번호는 꾸밈(CSS)으로 붙여서, 복사할 때 딸려 가지 않는다 */
function PlainText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return (
    <div className="doc__text" role="document">
      {lines.map((line, index) => (
        <div key={index} className="doc__line">
          {line === "" ? "\n" : line}
        </div>
      ))}
    </div>
  );
}

function Markdown({ document, onOpen }: { document: OpenDocument & { content: { state: "ready" } }; onOpen(path: string): void }) {
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest("a");
    if (!link) return;
    // 링크를 눌러도 앱 화면이 다른 곳으로 넘어가지 않게 한다
    event.preventDefault();
    const target = resolveLink(document.path, link.getAttribute("href") ?? "");
    if (target) onOpen(target);
  }

  return (
    <div
      // 내용이 바뀌면 새로 만들어 머메이드 그림도 다시 그린다
      key={document.content.stamp}
      className="doc__markdown"
      role="document"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(document.content.text) }}
      ref={(host) => {
        if (host) void drawDiagrams(host);
      }}
    />
  );
}

function Body({ document, onOpen }: { document: OpenDocument; onOpen(path: string): void }) {
  const { content } = document;
  if (content.state === "loading") return null;
  if (content.state === "error") {
    return (
      <p className="doc__alert" role="alert">
        {documentErrorMessage(content.code)}
      </p>
    );
  }
  if (document.raw || document.kind === "text") return <PlainText text={content.text} />;
  if (document.kind === "markdown") return <Markdown document={{ ...document, content }} onOpen={onOpen} />;
  // sandbox를 비워 두면 문서 안의 스크립트가 실행되지 않고, 앱 화면에 손댈 수도 없다
  return <iframe className="doc__html" title={document.name} sandbox="" srcDoc={content.text} />;
}

export function DocumentPane({ documents, activePath, share, onSelect, onClose, onToggleRaw, onOpen }: Props) {
  const active = documents.find((document) => document.path === activePath);

  return (
    <section className="docpane" aria-label="문서 창" style={{ flexBasis: `${share * 100}%` }}>
      <div className="doctabs">
        <div className="doctabs__list" role="tablist" aria-label="문서 탭">
          {documents.map((document) => {
            const selected = document.path === activePath;
            return (
              <div key={document.path} className={selected ? "doctab doctab--selected" : "doctab"}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="doctab__select"
                  title={document.path}
                  onClick={() => onSelect(document.path)}
                >
                  {document.name}
                </button>
                <button
                  type="button"
                  className="doctab__close"
                  aria-label={`${document.name} 문서 닫기`}
                  onClick={() => onClose(document.path)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        {active && active.kind !== "text" && (
          <button
            type="button"
            className={active.raw ? "doctabs__raw doctabs__raw--on" : "doctabs__raw"}
            aria-pressed={active.raw}
            title="그려진 모습 대신 파일에 적힌 글자 그대로 봅니다"
            onClick={() => onToggleRaw(active.path)}
          >
            원문
          </button>
        )}
      </div>
      {/* 문서마다 따로 만들어, 다른 문서를 열면 맨 위부터 보인다. 같은 문서의 내용이 바뀔 때는 읽던 위치가 유지된다 */}
      <div key={active?.path} className="doc" role="tabpanel" aria-label={active ? active.name : "문서"}>
        {active && <Body document={active} onOpen={onOpen} />}
      </div>
    </section>
  );
}
