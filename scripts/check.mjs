// 품질 게이트. 빌드, 린트, 테스트를 순서대로 돌리고 하나라도 실패하면 멈춘다.
// 사용: npm run check   (앱만 만들려면 npm run build)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ui = join(root, "ui");
const buildOnly = process.argv.includes("--build-only");

function npm(script) {
  return () => spawnSync("npm", ["run", "--silent", script], { cwd: ui, stdio: "inherit", shell: true }).status === 0;
}
function core(action) {
  return () => spawnSync(process.execPath, [join(root, "scripts", "core.mjs"), action], { stdio: "inherit" }).status === 0;
}
function node(script) {
  return () => spawnSync(process.execPath, [join(root, "scripts", script)], { stdio: "inherit" }).status === 0;
}
function assemble() {
  const source = join(root, "build", "core", "Visual-Agent.exe");
  const target = join(root, "build", "dist", "Visual-Agent");
  if (!existsSync(source) || !existsSync(join(target, "ui", "index.html"))) return false;
  mkdirSync(target, { recursive: true });
  copyFileSync(source, join(target, "Visual-Agent.exe"));
  return true;
}

// Windows PowerShell 5.1은 BOM이 없는 UTF-8 파일의 한글을 다른 글자로 읽어, 주석 다음 줄이 통째로 사라질 수 있다
function powershellScriptsHaveBom() {
  const folder = join(root, "scripts");
  const broken = readdirSync(folder)
    .filter((name) => name.endsWith(".ps1"))
    .filter((name) => {
      const bytes = readFileSync(join(folder, name));
      return !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
    });
  for (const name of broken) {
    console.error(
      `scripts/${name}: UTF-8 BOM이 없습니다. PowerShell 5.1이 한글 주석을 잘못 읽어 다음 줄을 건너뛸 수 있습니다. "UTF-8 with BOM"으로 저장하세요.`,
    );
  }
  return broken.length === 0;
}

const steps = [
  { name: "스크립트 인코딩 검사", run: powershellScriptsHaveBom, gateOnly: true },
  { name: "화면 타입 검사", run: npm("typecheck"), gateOnly: true },
  { name: "화면 린트 (모듈 경계, 금지 패턴)", run: npm("lint"), gateOnly: true },
  { name: "색상표 검사", run: npm("lint:colors"), gateOnly: true },
  { name: "화면 테스트", run: npm("test"), gateOnly: true },
  { name: "코어 파일 규칙 검사 (덮어쓰기·완전 삭제 금지)", run: node("lint-core-files.mjs"), gateOnly: true },
  { name: "화면 빌드", run: npm("build") },
  { name: "코어 빌드", run: core("build") },
  { name: "코어 테스트", run: core("test"), gateOnly: true },
  { name: "실행 파일 묶기 (build/dist/Visual-Agent)", run: assemble },
  { name: "앱 창 테스트 (실제 창이 잠시 뜹니다)", run: npm("e2e"), gateOnly: true },
].filter((step) => !buildOnly || !step.gateOnly);

const results = [];
for (const step of steps) {
  console.log(`\n── ${step.name}`);
  const ok = step.run();
  results.push({ name: step.name, ok });
  if (!ok) break;
}

console.log("\n══ 결과");
for (const result of results) console.log(`${result.ok ? "통과" : "실패"}  ${result.name}`);
const failed = results.some((result) => !result.ok);
const skipped = steps.length - results.length;
if (skipped > 0) console.log(`(실패 뒤 ${skipped}단계는 실행하지 않음)`);
console.log(failed ? "\n품질 게이트 실패" : buildOnly ? "\n빌드 완료" : "\n품질 게이트 통과");
process.exit(failed ? 1 : 0);
