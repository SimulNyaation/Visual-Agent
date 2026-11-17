#include "app/app_window.h"

#include <future>

#include <dwmapi.h>
#include <shobjidl.h>
#include <windowsx.h>

#include "theme_kirin.gen.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace va::app {

namespace {

constexpr wchar_t kWindowClass[] = L"VisualAgentWindow";
constexpr wchar_t kCaptionClass[] = L"VisualAgentCaption";
constexpr wchar_t kTitle[] = L"Visual-Agent";

constexpr UINT kPickFolderMessage = WM_APP + 1;
constexpr UINT kForceCloseMessage = WM_APP + 2;

// 화면(CSS) 기준 크기. 실제 픽셀은 배율을 곱한다
constexpr int kTitleBarHeight = 40;
constexpr int kCaptionButtonWidth = 46;
constexpr int kCaptionButtonCount = 3;
constexpr int kTopStripHeight = 4;   // 창 위쪽 가장자리로 크기를 조절하는 띠
constexpr int kCornerWidth = 12;
constexpr int kMinWidth = 640;
constexpr int kMinHeight = 400;

constexpr COLORREF colorref(std::uint32_t rgb) {
    return RGB((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
}

std::optional<std::filesystem::path> showFolderDialog(HWND owner) {
    ComPtr<IFileOpenDialog> dialog;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&dialog)))) {
        return std::nullopt;
    }
    DWORD options = 0;
    dialog->GetOptions(&options);
    dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    dialog->SetTitle(L"프로젝트 폴더 선택");
    if (FAILED(dialog->Show(owner))) return std::nullopt;  // 취소 포함

    ComPtr<IShellItem> item;
    if (FAILED(dialog->GetResult(&item))) return std::nullopt;
    PWSTR raw = nullptr;
    if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &raw))) return std::nullopt;
    std::filesystem::path folder(raw);
    CoTaskMemFree(raw);
    return folder;
}

std::wstring widen(const std::string& ascii) { return std::wstring(ascii.begin(), ascii.end()); }

}  // namespace

bool AppWindow::create(HINSTANCE instance) {
    instance_ = instance;

    WNDCLASSEXW windowClass{sizeof(WNDCLASSEXW)};
    windowClass.lpfnWndProc = windowProc;
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = CreateSolidBrush(colorref(theme::kBg2));
    windowClass.lpszClassName = kWindowClass;
    if (!RegisterClassExW(&windowClass)) return false;

    WNDCLASSEXW captionClass{sizeof(WNDCLASSEXW)};
    captionClass.lpfnWndProc = captionProc;
    captionClass.hInstance = instance;
    captionClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    captionClass.lpszClassName = kCaptionClass;
    if (!RegisterClassExW(&captionClass)) return false;

    hwnd_ = CreateWindowExW(0, kWindowClass, kTitle, WS_OVERLAPPEDWINDOW, CW_USEDEFAULT,
                            CW_USEDEFAULT, 1280, 800, nullptr, nullptr, instance, this);
    if (!hwnd_) return false;
    dpi_ = GetDpiForWindow(hwnd_);

    const BOOL dark = TRUE;
    DwmSetWindowAttribute(hwnd_, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));
    const COLORREF border = colorref(theme::kLineStrong);
    DwmSetWindowAttribute(hwnd_, DWMWA_BORDER_COLOR, &border, sizeof(border));

    caption_ = CreateWindowExW(0, kCaptionClass, L"", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS, 0,
                               0, 0, 0, hwnd_, nullptr, instance, this);
    if (!caption_) return false;

    // 제목 표시줄을 뺀 창 틀 계산(WM_NCCALCSIZE)을 다시 하게 한다
    SetWindowPos(hwnd_, nullptr, 0, 0, 0, 0,
                 SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER);
    ShowWindow(hwnd_, SW_SHOWNORMAL);
    UpdateWindow(hwnd_);
    return true;
}

void AppWindow::failStartup(const wchar_t* message) {
    MessageBoxW(hwnd_, message, kTitle, MB_OK | MB_ICONERROR);
    DestroyWindow(hwnd_);
}

void AppWindow::forceClose() { PostMessageW(hwnd_, kForceCloseMessage, 0, 0); }

void AppWindow::loadUi(const UiTarget& target) {
    target_ = target;
    const HRESULT result = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, target_.userDataFolder.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT envResult, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(envResult) || !environment) {
                    failStartup(L"화면을 표시하는 부품(WebView2)을 시작하지 못했습니다.\n"
                                L"Microsoft Edge WebView2 런타임을 설치한 뒤 다시 실행해 주세요.");
                    return S_OK;
                }
                environment->CreateCoreWebView2Controller(
                    hwnd_,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [this](HRESULT controllerResult,
                               ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(controllerResult) || !controller) {
                                failStartup(L"화면을 만들지 못했습니다. 다시 실행해 주세요.");
                                return S_OK;
                            }
                            onControllerReady(controller);
                            return S_OK;
                        })
                        .Get());
                return S_OK;
            })
            .Get());
    if (FAILED(result)) {
        failStartup(L"화면을 표시하는 부품(WebView2)을 찾을 수 없습니다.\n"
                    L"Microsoft Edge WebView2 런타임을 설치한 뒤 다시 실행해 주세요.");
    }
}

void AppWindow::onControllerReady(ICoreWebView2Controller* controller) {
    controller_ = controller;
    controller_->get_CoreWebView2(&webview_);

    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(controller_.As(&controller2))) {
        const std::uint32_t bg = theme::kBg1;
        controller2->put_DefaultBackgroundColor(
            COREWEBVIEW2_COLOR{255, static_cast<BYTE>((bg >> 16) & 0xFF),
                               static_cast<BYTE>((bg >> 8) & 0xFF), static_cast<BYTE>(bg & 0xFF)});
    }

    // 요청하지 않은 브라우저 기능(우클릭 메뉴, 단축키, 확대, 개발자 도구)은 모두 끈다
    ComPtr<ICoreWebView2Settings> settings;
    webview_->get_Settings(&settings);
    settings->put_AreDefaultContextMenusEnabled(FALSE);
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
    ComPtr<ICoreWebView2Settings3> settings3;
    if (SUCCEEDED(settings.As(&settings3))) settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
    ComPtr<ICoreWebView2Settings5> settings5;
    if (SUCCEEDED(settings.As(&settings5))) settings5->put_IsPinchZoomEnabled(FALSE);
    ComPtr<ICoreWebView2Settings6> settings6;
    if (SUCCEEDED(settings.As(&settings6))) settings6->put_IsSwipeNavigationEnabled(FALSE);
    // 화면이 CSS(app-region: drag)로 지정한 곳을 끌면 창이 움직이게 한다
    ComPtr<ICoreWebView2Settings9> settings9;
    if (SUCCEEDED(settings.As(&settings9))) settings9->put_IsNonClientRegionSupportEnabled(TRUE);

    // 이 앱의 화면 주소 밖으로는 이동하지 않고, 새 창도 열지 않는다
    const std::wstring origin = target_.url.substr(0, target_.url.find(L'/', 8));
    webview_->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [origin](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                LPWSTR raw = nullptr;
                args->get_Uri(&raw);
                const std::wstring uri = raw ? raw : L"";
                CoTaskMemFree(raw);
                if (uri.rfind(origin + L"/", 0) != 0) args->put_Cancel(TRUE);
                return S_OK;
            })
            .Get(),
        nullptr);
    webview_->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                args->put_Handled(TRUE);
                return S_OK;
            })
            .Get(),
        nullptr);

    const std::wstring script =
        L"window.__VA__ = Object.freeze({ token: \"" + widen(target_.token) +
        L"\", captionWidth: " + std::to_wstring(kCaptionButtonWidth * kCaptionButtonCount) +
        L", titleBarHeight: " + std::to_wstring(kTitleBarHeight) + L" });";
    webview_->AddScriptToExecuteOnDocumentCreated(
        script.c_str(),
        Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
            [this](HRESULT, LPCWSTR) -> HRESULT {
                webview_->Navigate(target_.url.c_str());
                return S_OK;
            })
            .Get());

    controller_->put_IsVisible(TRUE);
    layout();
}

int AppWindow::run() {
    MSG message;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return static_cast<int>(message.wParam);
}

std::optional<std::filesystem::path> AppWindow::pickFolder() {
    std::promise<std::optional<std::filesystem::path>> promise;
    auto future = promise.get_future();
    if (!PostMessageW(hwnd_, kPickFolderMessage, 0, reinterpret_cast<LPARAM>(&promise))) {
        return std::nullopt;
    }
    return future.get();
}

int AppWindow::scale(int cssPixels) const { return MulDiv(cssPixels, static_cast<int>(dpi_), 96); }

int AppWindow::topStrip() const { return IsZoomed(hwnd_) ? 0 : scale(kTopStripHeight); }

RECT AppWindow::captionRect() const {
    RECT client{};
    GetClientRect(hwnd_, &client);
    const int width = scale(kCaptionButtonWidth * kCaptionButtonCount);
    // 제목 표시줄 아래쪽 경계선(1px)은 화면이 그리므로 그만큼 덜 덮는다
    return RECT{client.right - width, topStrip(), client.right,
                topStrip() + scale(kTitleBarHeight) - scale(1)};
}

void AppWindow::layout() {
    if (!caption_) return;  // 창을 만드는 도중에는 아직 배치할 것이 없다
    RECT client{};
    GetClientRect(hwnd_, &client);
    if (controller_) {
        controller_->put_Bounds(RECT{0, topStrip(), client.right, client.bottom});
    }
    const RECT caption = captionRect();
    // 화면(WebView2) 위에 창 버튼이 보이도록 맨 위에 둔다
    SetWindowPos(caption_, HWND_TOP, caption.left, caption.top, caption.right - caption.left,
                 caption.bottom - caption.top, SWP_NOACTIVATE);
    InvalidateRect(caption_, nullptr, TRUE);
}

LRESULT AppWindow::hitTest(LPARAM lParam) {
    const LRESULT frame = DefWindowProcW(hwnd_, WM_NCHITTEST, 0, lParam);
    if (frame != HTCLIENT) return frame;

    POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
    ScreenToClient(hwnd_, &point);
    RECT client{};
    GetClientRect(hwnd_, &client);

    if (point.y < topStrip()) {
        if (point.x < scale(kCornerWidth)) return HTTOPLEFT;
        if (point.x >= client.right - scale(kCornerWidth)) return HTTOPRIGHT;
        return HTTOP;
    }
    return HTCLIENT;
}

// 창 버튼 위의 점(화면 좌표)이 어느 버튼인지 답한다
LRESULT AppWindow::captionHitTest(LPARAM lParam) {
    POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
    ScreenToClient(caption_, &point);
    const int index = point.x / scale(kCaptionButtonWidth);
    if (index <= kMinimize) return HTMINBUTTON;
    if (index == kMaximize) return HTMAXBUTTON;
    return HTCLOSE;
}

// 창 버튼 위에서 일어난 마우스 입력을 처리한다. 처리했으면 true
bool AppWindow::handleCaptionMouse(UINT message, WPARAM wParam) {
    const CaptionButton button = wParam == HTMINBUTTON   ? kMinimize
                                 : wParam == HTMAXBUTTON ? kMaximize
                                 : wParam == HTCLOSE     ? kClose
                                                         : kNone;
    switch (message) {
        case WM_NCMOUSEMOVE: {
            setCaptionHover(button);
            TRACKMOUSEEVENT track{sizeof(TRACKMOUSEEVENT), TME_LEAVE | TME_NONCLIENT, caption_, 0};
            TrackMouseEvent(&track);
            return true;
        }
        case WM_NCMOUSELEAVE:
            pressed_ = kNone;
            hover_ = kNone;
            InvalidateRect(caption_, nullptr, FALSE);
            return true;
        case WM_NCLBUTTONDOWN:
        case WM_NCLBUTTONDBLCLK:
            pressCaption(button);
            return true;
        case WM_NCLBUTTONUP:
            releaseCaption(button);
            return true;
        default:
            return false;
    }
}

void AppWindow::setCaptionHover(CaptionButton button) {
    if (hover_ == button) return;
    hover_ = button;
    InvalidateRect(caption_, nullptr, FALSE);
}

void AppWindow::pressCaption(CaptionButton button) {
    pressed_ = button;
    InvalidateRect(caption_, nullptr, FALSE);
}

void AppWindow::releaseCaption(CaptionButton button) {
    const bool clicked = (pressed_ == button);
    pressed_ = kNone;
    InvalidateRect(caption_, nullptr, FALSE);
    if (!clicked) return;
    switch (button) {
        case kMinimize: ShowWindow(hwnd_, SW_MINIMIZE); break;
        case kMaximize: ShowWindow(hwnd_, IsZoomed(hwnd_) ? SW_RESTORE : SW_MAXIMIZE); break;
        case kClose: PostMessageW(hwnd_, WM_CLOSE, 0, 0); break;
        default: break;
    }
}

void AppWindow::paintCaption(HWND caption) {
    PAINTSTRUCT paint{};
    const HDC dc = BeginPaint(caption, &paint);
    RECT area{};
    GetClientRect(caption, &area);

    const HBRUSH base = CreateSolidBrush(colorref(theme::kBg2));
    FillRect(dc, &area, base);
    DeleteObject(base);

    // Windows에 들어 있는 창 버튼 그림 글꼴
    const HFONT font = CreateFontW(-scale(10), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                                   DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                   CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe MDL2 Assets");
    const HGDIOBJ previousFont = SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);

    const wchar_t glyphs[kCaptionButtonCount] = {L'\xE921', IsZoomed(hwnd_) ? L'\xE923' : L'\xE922',
                                                 L'\xE8BB'};
    const int width = scale(kCaptionButtonWidth);
    for (int index = 0; index < kCaptionButtonCount; ++index) {
        RECT button{area.left + index * width, area.top, area.left + (index + 1) * width,
                    area.bottom};
        const bool active = (hover_ == index) || (pressed_ == index);
        if (active) {
            const HBRUSH fill =
                CreateSolidBrush(colorref(index == kClose ? theme::kRust : theme::kBg3));
            FillRect(dc, &button, fill);
            DeleteObject(fill);
        }
        SetTextColor(dc, colorref(active && index == kClose ? theme::kBg0 : theme::kText1));
        DrawTextW(dc, &glyphs[index], 1, &button, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    }

    SelectObject(dc, previousFont);
    DeleteObject(font);
    EndPaint(caption, &paint);
}

LRESULT AppWindow::handle(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_NCCALCSIZE: {
            if (!wParam) break;
            // 좌우·아래 창 틀은 그대로 두고 위쪽 제목 표시줄만 없앤다
            auto* params = reinterpret_cast<NCCALCSIZE_PARAMS*>(lParam);
            const int frameX = GetSystemMetricsForDpi(SM_CXFRAME, dpi_) +
                               GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi_);
            const int frameY = GetSystemMetricsForDpi(SM_CYFRAME, dpi_) +
                               GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi_);
            params->rgrc[0].left += frameX;
            params->rgrc[0].right -= frameX;
            params->rgrc[0].bottom -= frameY;
            // 최대화하면 창 틀이 화면 밖으로 나가므로 위쪽도 그만큼 들여 화면이 잘리지 않게 한다
            if (IsZoomed(hwnd_)) params->rgrc[0].top += frameY;
            return 0;
        }
        case WM_NCHITTEST:
            return hitTest(lParam);
        case WM_SIZE:
            layout();
            return 0;
        case WM_MOVE:
            if (controller_) controller_->NotifyParentWindowPositionChanged();
            break;
        case WM_SETFOCUS:
            if (controller_) controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            return 0;
        case WM_DPICHANGED: {
            dpi_ = HIWORD(wParam);
            const auto* suggested = reinterpret_cast<const RECT*>(lParam);
            SetWindowPos(hwnd_, nullptr, suggested->left, suggested->top,
                         suggested->right - suggested->left, suggested->bottom - suggested->top,
                         SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case WM_GETMINMAXINFO: {
            auto* info = reinterpret_cast<MINMAXINFO*>(lParam);
            info->ptMinTrackSize = POINT{scale(kMinWidth), scale(kMinHeight)};
            return 0;
        }
        case WM_CLOSE:
            if (closeGuard_ && !closeGuard_()) return 0;
            break;
        case kForceCloseMessage:
            DestroyWindow(hwnd_);
            return 0;
        case kPickFolderMessage: {
            auto* promise =
                reinterpret_cast<std::promise<std::optional<std::filesystem::path>>*>(lParam);
            promise->set_value(showFolderDialog(hwnd_));
            return 0;
        }
        case WM_DESTROY:
            if (controller_) controller_->Close();
            controller_.Reset();
            webview_.Reset();
            PostQuitMessage(0);
            return 0;
        default:
            break;
    }
    return DefWindowProcW(hwnd_, message, wParam, lParam);
}

LRESULT CALLBACK AppWindow::windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_NCCREATE) {
        const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lParam);
        auto* self = static_cast<AppWindow*>(create->lpCreateParams);
        self->hwnd_ = hwnd;
        self->dpi_ = GetDpiForWindow(hwnd);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
    }
    auto* self = reinterpret_cast<AppWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (!self) return DefWindowProcW(hwnd, message, wParam, lParam);
    return self->handle(message, wParam, lParam);
}

LRESULT CALLBACK AppWindow::captionProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_NCCREATE) {
        const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lParam);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA,
                          reinterpret_cast<LONG_PTR>(create->lpCreateParams));
    }
    auto* self = reinterpret_cast<AppWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    switch (message) {
        case WM_NCHITTEST:
            // "최소화·최대화·닫기 버튼 위"라고 직접 답한다. 입력을 아래 창으로 넘기면(HTTRANSPARENT)
            // 다른 프로세스가 그리는 화면(WebView2)이 클릭을 가져가 버튼이 눌리지 않는다
            if (self) return self->captionHitTest(lParam);
            break;
        case WM_NCMOUSEMOVE:
        case WM_NCMOUSELEAVE:
        case WM_NCLBUTTONDOWN:
        case WM_NCLBUTTONDBLCLK:
        case WM_NCLBUTTONUP:
            if (self && self->handleCaptionMouse(message, wParam)) return 0;
            break;
        case WM_PAINT:
            if (self) {
                self->paintCaption(hwnd);
                return 0;
            }
            break;
        case WM_ERASEBKGND:
            return 1;
        default:
            break;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

}  // namespace va::app
