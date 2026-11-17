#include "data/shell_finder.h"

#include <algorithm>

#include <windows.h>

#include "domain/terminal_rules.h"

namespace va::data {

namespace {

using Path = std::filesystem::path;

Path environmentPath(const wchar_t* name) {
    std::wstring value(32767, L'\0');
    const DWORD length = GetEnvironmentVariableW(name, value.data(), static_cast<DWORD>(value.size()));
    value.resize(length);
    return Path(value);
}

// Microsoft Store로 설치한 프로그램의 실행 파일은 보통 파일이 아닌 연결이라, 속성을 읽을 수 있는지만 본다
bool present(const Path& file) {
    if (file.empty() || !file.is_absolute()) return false;
    const DWORD attributes = GetFileAttributesW(file.c_str());
    return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

Path firstPresent(const std::vector<Path>& candidates) {
    for (const auto& candidate : candidates) {
        if (present(candidate)) return candidate;
    }
    return {};
}

struct Location {
    Path program;
    std::wstring arguments;
};

Location locate(const std::string& id) {
    const Path system = environmentPath(L"SystemRoot") / "System32";
    const Path programs = environmentPath(L"ProgramFiles");
    const Path local = environmentPath(L"LOCALAPPDATA");

    if (id == "pwsh") {
        return {firstPresent({programs / "PowerShell" / "7" / "pwsh.exe",
                              local / "Microsoft" / "WindowsApps" / "pwsh.exe"}),
                L"-NoLogo"};
    }
    if (id == "cmd") return {firstPresent({system / "cmd.exe"}), L""};
    return {};
}

}  // namespace

std::vector<InstalledShell> findShells(const std::vector<std::string>& hidden) {
    std::vector<InstalledShell> found;
    for (const auto& kind : domain::knownShells()) {
        if (std::find(hidden.begin(), hidden.end(), kind.id) != hidden.end()) continue;
        const Location location = locate(kind.id);
        if (location.program.empty()) continue;
        found.push_back({kind.id, kind.label, location.program, location.arguments});
    }
    return found;
}

}  // namespace va::data
