#include <cstdlib>
#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

#include <windows.h>

#include <shlobj.h>

#include "app/app_window.h"
#include "data/recycle_bin.h"
#include "data/settings_store.h"
#include "data/shell_finder.h"
#include "server/api_server.h"

namespace {

std::filesystem::path knownFolder(REFKNOWNFOLDERID id) {
    PWSTR raw = nullptr;
    std::filesystem::path result;
    if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &raw))) result = raw;
    CoTaskMemFree(raw);
    return result;
}

std::filesystem::path executableDirectory() {
    std::wstring buffer(MAX_PATH, L'\0');
    for (;;) {
        const DWORD length = GetModuleFileNameW(nullptr, buffer.data(),
                                                static_cast<DWORD>(buffer.size()));
        if (length < buffer.size()) {
            buffer.resize(length);
            break;
        }
        buffer.resize(buffer.size() * 2);
    }
    return std::filesystem::path(buffer).parent_path();
}

std::wstring environment(const wchar_t* name) {
    std::wstring value(32767, L'\0');
    const DWORD length =
        GetEnvironmentVariableW(name, value.data(), static_cast<DWORD>(value.size()));
    value.resize(length);
    return value;
}

// VA_HIDE_SHELLS에 쉼표로 적힌 셸은 없는 것으로 친다. 자동 테스트가 "그 셸이 설치되지 않은 컴퓨터"를 흉내 내기 위함이다
std::vector<std::string> hiddenShells() {
    const std::wstring raw = environment(L"VA_HIDE_SHELLS");
    std::vector<std::string> hidden;
    std::string part;
    for (const wchar_t c : raw + L",") {
        if (c != L',') {
            // 셸의 내부 이름은 영문자뿐이다
            part.push_back(static_cast<char>(c));
        } else if (!part.empty()) {
            hidden.push_back(part);
            part.clear();
        }
    }
    return hidden;
}

struct DataFolders {
    std::filesystem::path settings;  // 열려 있던 탭 등 개인 설정
    std::filesystem::path webview;   // 화면 부품의 캐시
};

// VA_DATA_DIR이 있으면 그 폴더만 쓴다. 자동 테스트가 실제 개인 설정을 건드리지 않게 하기 위함이다
DataFolders dataFolders() {
    const std::wstring overrideDir = environment(L"VA_DATA_DIR");
    if (!overrideDir.empty()) {
        const std::filesystem::path root(overrideDir);
        return {root, root / "webview"};
    }
    return {knownFolder(FOLDERID_RoamingAppData) / "Visual-Agent",
            knownFolder(FOLDERID_LocalAppData) / "Visual-Agent" / "WebView2"};
}

}  // namespace

int APIENTRY wWinMain(HINSTANCE instance, HINSTANCE, LPWSTR, int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;

    const auto uiDirectory = executableDirectory() / "ui";
    std::error_code ec;
    if (!std::filesystem::exists(uiDirectory / "index.html", ec)) {
        MessageBoxW(nullptr,
                    L"화면 파일(ui 폴더)을 찾을 수 없습니다.\n"
                    L"Visual-Agent.exe와 ui 폴더를 같은 위치에 두고 다시 실행해 주세요.",
                    L"Visual-Agent", MB_OK | MB_ICONERROR);
        return 1;
    }

    const auto folders = dataFolders();

    va::app::AppWindow window;
    if (!window.create(instance)) return 1;

    va::server::ApiServerOptions options;
    options.uiDirectory = uiDirectory;
    options.token = va::server::generateToken();
    options.pickFolder = [&window] { return window.pickFolder(); };
    options.folderExists = [](const std::filesystem::path& folder) {
        std::error_code check;
        return std::filesystem::is_directory(folder, check);
    };
    // VA_TRASH_DIR이 있으면 지운 것을 휴지통 대신 그 폴더로 보낸다. 자동 테스트가 실제 휴지통을 채우지 않게 하기 위함이다
    const std::wstring trashDir = environment(L"VA_TRASH_DIR");
    options.trash = trashDir.empty() ? va::data::recycleBinTrash()
                                     : va::data::folderTrash(std::filesystem::path(trashDir));
    options.shells = va::data::findShells(hiddenShells());
    options.quit = [&window] { window.forceClose(); };
    const std::string token = options.token;

    va::server::ApiServer server(std::move(options), va::data::SettingsStore(folders.settings));
    if (!server.start()) {
        MessageBoxW(nullptr, L"앱 안의 서버를 시작하지 못했습니다. 다시 실행해 주세요.",
                    L"Visual-Agent", MB_OK | MB_ICONERROR);
        return 1;
    }

    window.setCloseGuard([&server] { return server.requestClose(); });
    window.loadUi({L"http://127.0.0.1:" + std::to_wstring(server.port()) + L"/index.html",
                   folders.webview.wstring(), token});
    const int exitCode = window.run();

    server.stop();
    CoUninitialize();
    return exitCode;
}
