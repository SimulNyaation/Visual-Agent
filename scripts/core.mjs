// 코어(C++)를 빌드하고 테스트한다. Visual Studio Build Tools의 컴파일러·CMake·Ninja를 찾아 쓴다.
// 사용: node scripts/core.mjs build | test
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2];

function fail(message) {
  console.error(`\n[core] ${message}`);
  process.exit(1);
}

const vswhere = join(
  process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  "Microsoft Visual Studio",
  "Installer",
  "vswhere.exe",
);
if (!existsSync(vswhere)) {
  fail("Visual Studio Build Tools를 찾을 수 없습니다. 'C++를 사용한 데스크톱 개발' 구성 요소를 설치하세요.");
}
const vsPath = execFileSync(vswhere, ["-latest", "-products", "*", "-property", "installationPath"], {
  encoding: "utf8",
}).trim();
const vcvars = join(vsPath, "VC", "Auxiliary", "Build", "vcvars64.bat");
const cmakeBin = join(vsPath, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "CMake", "bin");
const ninjaBin = join(vsPath, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "Ninja");
if (!existsSync(vcvars) || !existsSync(join(cmakeBin, "cmake.exe"))) {
  fail(`Visual Studio(${vsPath})에 C++ 컴파일러 또는 CMake가 없습니다. 'C++ CMake 도구' 구성 요소를 설치하세요.`);
}

// vcvars가 vswhere를 찾을 수 있게 한다
const installerDir = dirname(vswhere);
const vcpkgRoot = process.env.VCPKG_ROOT ?? join(homedir(), "vcpkg");
if (!existsSync(join(vcpkgRoot, "vcpkg.exe"))) {
  fail(`vcpkg를 찾을 수 없습니다(${vcpkgRoot}). vcpkg를 설치하거나 VCPKG_ROOT 환경 변수로 위치를 알려 주세요.`);
}

const steps = {
  build: ["cmake --preset release", "cmake --build --preset release"],
  test: ["ctest --preset release"],
}[action];
if (!steps) fail("사용법: node scripts/core.mjs build | test");

const command = [`call "${vcvars}" >nul`, ...steps].join(" && ");
const result = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
  cwd: join(root, "core"),
  stdio: "inherit",
  windowsVerbatimArguments: true,
  env: {
    ...process.env,
    VCPKG_ROOT: vcpkgRoot,
    PATH: `${cmakeBin};${ninjaBin};${installerDir};${process.env.PATH}`,
  },
});
process.exit(result.status ?? 1);
