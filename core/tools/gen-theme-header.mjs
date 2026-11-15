// design/theme-kirin.css의 색을 C++ 상수로 옮긴다. 창 쪽 코드가 색 값을 직접 쓰지 않게 하기 위함이다.
// 사용: node gen-theme-header.mjs <theme.css> <out.h>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [cssPath, outPath] = process.argv.slice(2);
if (!cssPath || !outPath) {
  console.error("사용법: node gen-theme-header.mjs <theme.css> <out.h>");
  process.exit(2);
}

const css = readFileSync(cssPath, "utf8");
const lines = [];
for (const match of css.matchAll(/--([a-z0-9-]+):\s*#([0-9a-fA-F]{6})\s*;/g)) {
  const name = match[1]
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  lines.push(`inline constexpr std::uint32_t k${name} = 0x${match[2].toUpperCase()};`);
}
if (lines.length === 0) {
  console.error(`${cssPath}에서 색 토큰을 찾지 못했습니다. "--이름: #RRGGBB;" 형식인지 확인하세요.`);
  process.exit(1);
}

const header = `// 자동 생성 파일. 직접 고치지 않는다. 원본: design/theme-kirin.css
#pragma once

#include <cstdint>

namespace va::theme {

// 0xRRGGBB
${lines.join("\n")}

}  // namespace va::theme
`;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, header);
