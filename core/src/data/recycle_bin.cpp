#include "data/recycle_bin.h"

#include <atomic>
#include <memory>
#include <system_error>

#include <windows.h>

#include <shlobj.h>
#include <shobjidl.h>
#include <wrl/client.h>

namespace va::data {

namespace {

using Microsoft::WRL::ComPtr;

// 휴지통을 거치지 않고 바로 지워지려는 항목이 있으면 작업을 멈춘다
class RecycleOnlySink final : public IFileOperationProgressSink {
public:
    bool refused() const { return refused_; }

    IFACEMETHODIMP QueryInterface(REFIID id, void** out) override {
        if (id == IID_IUnknown || id == IID_IFileOperationProgressSink) {
            *out = static_cast<IFileOperationProgressSink*>(this);
            AddRef();
            return S_OK;
        }
        *out = nullptr;
        return E_NOINTERFACE;
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return ++references_; }
    IFACEMETHODIMP_(ULONG) Release() override {
        const ULONG left = --references_;
        if (left == 0) delete this;
        return left;
    }

    IFACEMETHODIMP PreDeleteItem(DWORD flags, IShellItem*) override {
        if (flags & TSF_DELETE_RECYCLE_IF_POSSIBLE) return S_OK;
        refused_ = true;
        return E_ABORT;
    }

    IFACEMETHODIMP StartOperations() override { return S_OK; }
    IFACEMETHODIMP FinishOperations(HRESULT) override { return S_OK; }
    IFACEMETHODIMP PreRenameItem(DWORD, IShellItem*, LPCWSTR) override { return S_OK; }
    IFACEMETHODIMP PostRenameItem(DWORD, IShellItem*, LPCWSTR, HRESULT, IShellItem*) override { return S_OK; }
    IFACEMETHODIMP PreMoveItem(DWORD, IShellItem*, IShellItem*, LPCWSTR) override { return S_OK; }
    IFACEMETHODIMP PostMoveItem(DWORD, IShellItem*, IShellItem*, LPCWSTR, HRESULT, IShellItem*) override { return S_OK; }
    IFACEMETHODIMP PreCopyItem(DWORD, IShellItem*, IShellItem*, LPCWSTR) override { return S_OK; }
    IFACEMETHODIMP PostCopyItem(DWORD, IShellItem*, IShellItem*, LPCWSTR, HRESULT, IShellItem*) override { return S_OK; }
    IFACEMETHODIMP PostDeleteItem(DWORD, IShellItem*, HRESULT, IShellItem*) override { return S_OK; }
    IFACEMETHODIMP PreNewItem(DWORD, IShellItem*, LPCWSTR) override { return S_OK; }
    IFACEMETHODIMP PostNewItem(DWORD, IShellItem*, LPCWSTR, LPCWSTR, DWORD, HRESULT, IShellItem*) override { return S_OK; }
    IFACEMETHODIMP UpdateProgress(UINT, UINT) override { return S_OK; }
    IFACEMETHODIMP ResetTimer() override { return S_OK; }
    IFACEMETHODIMP PauseTimer() override { return S_OK; }
    IFACEMETHODIMP ResumeTimer() override { return S_OK; }

private:
    ~RecycleOnlySink() = default;

    std::atomic<ULONG> references_{1};
    bool refused_ = false;
};

struct ComScope {
    HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    ~ComScope() {
        if (SUCCEEDED(result)) CoUninitialize();
    }
};

std::string recycle(const std::vector<std::filesystem::path>& paths) {
    const ComScope com;

    ComPtr<IFileOperation> operation;
    if (FAILED(CoCreateInstance(CLSID_FileOperation, nullptr, CLSCTX_ALL,
                                IID_PPV_ARGS(&operation)))) {
        return "failed";
    }
    if (FAILED(operation->SetOperationFlags(FOF_NO_UI | FOF_ALLOWUNDO | FOFX_EARLYFAILURE))) {
        return "failed";
    }

    ComPtr<RecycleOnlySink> sink;
    sink.Attach(new RecycleOnlySink());
    DWORD cookie = 0;
    if (FAILED(operation->Advise(sink.Get(), &cookie))) return "failed";

    HRESULT result = S_OK;
    for (const auto& path : paths) {
        ComPtr<IShellItem> item;
        result = SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(&item));
        if (SUCCEEDED(result)) result = operation->DeleteItem(item.Get(), nullptr);
        if (FAILED(result)) break;
    }
    if (SUCCEEDED(result)) result = operation->PerformOperations();

    BOOL aborted = FALSE;
    operation->GetAnyOperationsAborted(&aborted);
    operation->Unadvise(cookie);

    if (sink->refused()) return "no_trash";
    if (result == HRESULT_FROM_WIN32(ERROR_SHARING_VIOLATION) ||
        result == HRESULT_FROM_WIN32(ERROR_ACCESS_DENIED) || result == E_ACCESSDENIED) {
        return "in_use";
    }
    if (FAILED(result) || aborted) {
        // 일부가 남아 있으면 쓰는 중이어서 지우지 못한 것이다
        for (const auto& path : paths) {
            if (GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES) return "in_use";
        }
        return "failed";
    }
    return {};
}

}  // namespace

TrashFn recycleBinTrash() { return recycle; }

TrashFn folderTrash(std::filesystem::path folder) {
    return [folder = std::move(folder),
            next = std::make_shared<std::atomic<unsigned>>(0u)](
               const std::vector<std::filesystem::path>& paths) -> std::string {
        std::error_code ec;
        std::filesystem::create_directories(folder, ec);
        // 먼저 모두 옮길 수 있는지 본다. 쓰는 중인 파일은 열 수 없다
        for (const auto& path : paths) {
            const DWORD attributes = GetFileAttributesW(path.c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES) return "failed";
            if (attributes & FILE_ATTRIBUTE_DIRECTORY) continue;
            const HANDLE file = CreateFileW(path.c_str(), DELETE, 0, nullptr, OPEN_EXISTING,
                                            FILE_ATTRIBUTE_NORMAL, nullptr);
            if (file == INVALID_HANDLE_VALUE) return "in_use";
            CloseHandle(file);
        }
        for (const auto& path : paths) {
            const auto target =
                folder / (std::to_wstring((*next)++) + L"-" + path.filename().wstring());
            if (!MoveFileExW(path.c_str(), target.c_str(), 0)) return "in_use";
        }
        return {};
    };
}

}  // namespace va::data
