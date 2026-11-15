// 앱 창. 제목 표시줄을 직접 그리고, 그 아래에 화면(WebView2)을 채운다.
#pragma once

#include <filesystem>
#include <optional>
#include <string>

#include <windows.h>

#include <WebView2.h>
#include <wrl.h>

namespace va::app {

struct UiTarget {
    std::wstring url;              // 화면 주소
    std::wstring userDataFolder;   // WebView2가 쓰는 캐시 폴더
    std::string token;             // 화면에 전달할 접속 값
};

class AppWindow {
public:
    bool create(HINSTANCE instance);
    void loadUi(const UiTarget& target);
    int run();

    // 서버 스레드에서 부른다. 창 스레드에서 폴더 선택 창을 띄우고 결과를 기다린다
    std::optional<std::filesystem::path> pickFolder();

private:
    enum CaptionButton { kNone = -1, kMinimize = 0, kMaximize = 1, kClose = 2 };

    static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    static LRESULT CALLBACK captionProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);

    LRESULT handle(UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT hitTest(LPARAM lParam);
    void layout();
    void paintCaption(HWND caption);
    void setCaptionHover(CaptionButton button);
    void pressCaption(CaptionButton button);
    void releaseCaption(CaptionButton button);
    void onControllerReady(ICoreWebView2Controller* controller);
    void failStartup(const wchar_t* message);

    int scale(int cssPixels) const;
    int topStrip() const;
    RECT captionRect() const;

    HINSTANCE instance_ = nullptr;
    HWND hwnd_ = nullptr;
    HWND caption_ = nullptr;
    UINT dpi_ = 96;
    CaptionButton hover_ = kNone;
    CaptionButton pressed_ = kNone;
    UiTarget target_;
    Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller_;
    Microsoft::WRL::ComPtr<ICoreWebView2> webview_;
};

}  // namespace va::app
