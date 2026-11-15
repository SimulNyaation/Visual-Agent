// 화면 코드가 색상표(design/theme-kirin.css)에 없는 색을 쓰는지 검사한다.
// 색 값(#RRGGBB, rgb(), hsl(), 색 이름)을 직접 쓰면 실패한다. var(--토큰)만 허용한다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const themePath = resolve(uiRoot, "..", "design", "theme-kirin.css");
const scanRoots = [join(uiRoot, "src"), join(uiRoot, "index.html")];

const themeTokens = new Set(
  [...readFileSync(themePath, "utf8").matchAll(/--([a-z0-9-]+)\s*:/g)].map((match) => match[1]),
);

const colorNames = [
  "black", "white", "red", "green", "blue", "yellow", "orange", "purple", "pink", "gray", "grey",
  "brown", "cyan", "magenta", "silver", "gold", "navy", "teal", "olive", "maroon", "beige", "ivory",
  "khaki", "tan", "crimson", "coral", "salmon", "indigo", "violet", "lime", "aqua",
];
// CSS 선언에서 색이 들어가는 속성
const colorProperty =
  /(?:^|[;{\s])(color|background|background-color|border(?:-[a-z]+)*|outline(?:-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?)\s*:\s*([^;}]+)/g;

function listFiles(target) {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target).flatMap((name) => listFiles(join(target, name)));
}

const problems = [];
function report(file, line, found, why) {
  problems.push(`${relative(uiRoot, file)}:${line}  ${found}\n    ${why}`);
}

for (const file of scanRoots.flatMap(listFiles)) {
  const extension = extname(file);
  if (![".css", ".ts", ".tsx", ".html"].includes(extension)) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  lines.forEach((text, index) => {
    const line = index + 1;
    for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      // TSX 안의 "#root" 같은 선택자·주소는 색이 아니다
      if (!/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(match[0])) continue;
      report(file, line, match[0], "색 값을 직접 쓰면 테마와 어긋납니다. design/theme-kirin.css의 토큰을 var(--이름)으로 쓰세요. 필요한 색이 없으면 색상표에 토큰을 먼저 추가하세요.");
    }
    for (const match of text.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/g)) {
      report(file, line, match[0] + "…)", "색 함수를 직접 쓰면 테마와 어긋납니다. design/theme-kirin.css에 토큰을 추가하고 var(--이름)으로 쓰세요.");
    }
    for (const match of text.matchAll(/var\(--([a-z0-9-]+)/g)) {
      const name = match[1];
      const looksLikeColor = /^(bg|text|line|mark|agent|state)-|^(ochre|patch|acacia|sage|moss|teal|rust)$/.test(name);
      if (looksLikeColor && !themeTokens.has(name)) {
        report(file, line, `var(--${name})`, "색상표에 없는 토큰입니다. design/theme-kirin.css에 정의된 이름을 쓰세요.");
      }
    }
    if (extension === ".css") {
      for (const match of text.matchAll(colorProperty)) {
        for (const name of colorNames) {
          if (new RegExp(`(^|[\\s,(])${name}($|[\\s,;)])`).test(match[2])) {
            report(file, line, `${match[1]}: … ${name}`, "색 이름을 직접 쓰면 테마와 어긋납니다. design/theme-kirin.css의 토큰을 var(--이름)으로 쓰세요.");
          }
        }
      }
    }
  });
}

// 창 쪽(C++) 코드도 색 값을 직접 쓰지 않는다. 색은 빌드 때 색상표에서 만든 theme_kirin.gen.h에서만 온다
const coreSrc = resolve(uiRoot, "..", "core", "src");
for (const file of listFiles(coreSrc)) {
  if (![".cpp", ".h"].includes(extname(file))) continue;
  readFileSync(file, "utf8").split(/\r?\n/).forEach((text, index) => {
    // RGB(255, …) 또는 COREWEBVIEW2_COLOR{255, 30, …}처럼 숫자로 적은 색
    for (const match of text.matchAll(/\bRGB\(\s*(?:0x)?\d|COREWEBVIEW2_COLOR\s*\{\s*\d+\s*,\s*\d/g)) {
      report(file, index + 1, match[0] + "…", "창 쪽 코드에 색 값을 직접 쓰면 테마와 어긋납니다. theme_kirin.gen.h의 va::theme 상수를 쓰세요. 필요한 색이 없으면 design/theme-kirin.css에 토큰을 먼저 추가하세요.");
    }
  });
}

if (problems.length > 0) {
  console.error(`색상표에 없는 색 사용 ${problems.length}건:\n`);
  console.error(problems.join("\n\n"));
  process.exit(1);
}
console.log(`색 검사 통과 (색상표 토큰 ${themeTokens.size}개 기준)`);
