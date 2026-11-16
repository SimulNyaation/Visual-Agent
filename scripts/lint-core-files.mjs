// 코어가 사용자의 파일을 덮어쓰거나 휴지통을 거치지 않고 지우는 코드를 쓰는지 검사한다.
// 사용: node scripts/lint-core-files.mjs [검사할 폴더]   (기본: core/src)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.argv[2] ?? join(root, "core", "src"));

// 앱 자신의 설정 파일(state.json)을 새 내용으로 바꿔 쓰는 곳. 사용자의 프로젝트 파일이 아니다
const allowed = new Set(["data/settings_store.cpp"]);

const overwrite =
  "이미 있는 파일을 말없이 덮어쓸 수 있습니다. 덮어쓰지 않는 방식(core/src/data/project_files.cpp의 moveNoReplace, CopyFileW(…, TRUE), CREATE_NEW)을 쓰세요.";
const permanent =
  "휴지통을 거치지 않고 완전히 지워 되찾을 수 없습니다. 지울 때는 ProjectFiles에 넘겨받은 TrashFn(휴지통)을 쓰세요.";

const rules = [
  { pattern: /\b(?:fs|filesystem)::rename\s*\(/, found: "std::filesystem::rename", why: overwrite },
  { pattern: /\bMOVEFILE_REPLACE_EXISTING\b/, found: "MOVEFILE_REPLACE_EXISTING", why: overwrite },
  { pattern: /\bReplaceFileW?\s*\(/, found: "ReplaceFile", why: overwrite },
  { pattern: /\bcopy_options::(?:overwrite_existing|update_existing)\b/, found: "copy_options::overwrite_existing", why: overwrite },
  { pattern: /\bCopyFile(?:Ex)?W?\s*\([^;]*,\s*FALSE\s*\)/, found: "CopyFileW(…, FALSE)", why: overwrite },
  { pattern: /\b(?:CREATE_ALWAYS|TRUNCATE_EXISTING)\b/, found: "CREATE_ALWAYS / TRUNCATE_EXISTING", why: overwrite },
  { pattern: /\b(?:fs|filesystem)::remove(?:_all)?\s*\(/, found: "std::filesystem::remove", why: permanent },
  { pattern: /\bremove_all\s*\(/, found: "remove_all", why: permanent },
  { pattern: /\b(?:DeleteFileW?|RemoveDirectoryW?)\s*\(/, found: "DeleteFile / RemoveDirectory", why: permanent },
  { pattern: /\bSHFileOperationW?\s*\(/, found: "SHFileOperation", why: permanent },
];

function listFiles(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const problems = [];
for (const file of listFiles(target)) {
  if (!/\.(?:cpp|h)$/.test(file)) continue;
  const name = relative(target, file).replaceAll("\\", "/");
  if (allowed.has(name)) continue;
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((text, index) => {
      const code = text.replace(/\/\/.*$/, "");
      for (const rule of rules) {
        if (rule.pattern.test(code)) problems.push(`${name}:${index + 1}  ${rule.found}\n    ${rule.why}`);
      }
    });
}

if (problems.length > 0) {
  console.error(`사용자 파일을 잃을 수 있는 코드 ${problems.length}건:\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  process.exit(1);
}
console.log("코어 파일 규칙 검사 통과 (덮어쓰기·완전 삭제 없음)");
