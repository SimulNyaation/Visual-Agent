#include "data/project_files.h"

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <string>
#include <system_error>

#include <windows.h>

#include "domain/project_tabs.h"

namespace va::data {

namespace fs = std::filesystem;
using domain::FileChange;

namespace {

// 연결 폴더를 만났을 때 쓰는, Windows 오류 코드와 겹치지 않는 값
constexpr DWORD kLinkFound = 0xE0000001;

fs::file_type typeOf(const fs::path& path) {
    std::error_code ec;
    return fs::symlink_status(path, ec).type();
}

bool present(const fs::path& path) {
    const auto type = typeOf(path);
    return type != fs::file_type::not_found && type != fs::file_type::none;
}

bool isLinkType(fs::file_type type) {
    return type == fs::file_type::symlink || type == fs::file_type::junction;
}

bool isFolder(const fs::path& path) { return typeOf(path) == fs::file_type::directory; }

std::string errorCode(DWORD error) {
    switch (error) {
        case ERROR_SUCCESS: return {};
        case kLinkFound: return "contains_link";
        case ERROR_SHARING_VIOLATION:
        case ERROR_LOCK_VIOLATION:
        case ERROR_ACCESS_DENIED: return "in_use";
        case ERROR_FILE_EXISTS:
        case ERROR_ALREADY_EXISTS: return "name_taken";
        case ERROR_FILE_NOT_FOUND:
        case ERROR_PATH_NOT_FOUND: return "not_found";
        default: return "failed";
    }
}

// 이미 있는 것을 덮어쓰지 않고 옮긴다
DWORD moveNoReplace(const fs::path& from, const fs::path& to) {
    return MoveFileExW(from.c_str(), to.c_str(), 0) ? ERROR_SUCCESS : GetLastError();
}

DWORD copyTree(const fs::path& from, const fs::path& to) {
    const auto type = typeOf(from);
    if (isLinkType(type)) return kLinkFound;
    if (type != fs::file_type::directory) {
        return CopyFileW(from.c_str(), to.c_str(), TRUE) ? ERROR_SUCCESS : GetLastError();
    }
    if (!CreateDirectoryW(to.c_str(), nullptr)) return GetLastError();

    std::error_code ec;
    for (fs::directory_iterator it(from, ec), end; !ec && it != end; it.increment(ec)) {
        const DWORD error = copyTree(it->path(), to / it->path().filename());
        if (error != ERROR_SUCCESS) return error;
    }
    return ec ? static_cast<DWORD>(ec.value()) : ERROR_SUCCESS;
}

std::string stampOf(const std::vector<FileEntry>& entries) {
    std::uint64_t hash = 14695981039346656037ull;
    const auto mix = [&hash](unsigned char byte) {
        hash ^= byte;
        hash *= 1099511628211ull;
    };
    for (const auto& entry : entries) {
        for (const char c : entry.name) mix(static_cast<unsigned char>(c));
        mix(0);
        mix(static_cast<unsigned char>(entry.kind));
    }
    static constexpr char kHex[] = "0123456789abcdef";
    std::string text(16, '0');
    for (int i = 15; i >= 0; --i, hash >>= 4) text[static_cast<std::size_t>(i)] = kHex[hash & 0xF];
    return text;
}

}  // namespace

ProjectFiles::ProjectFiles(fs::path root, TrashFn trash)
    : root_(std::move(root)), trash_(std::move(trash)) {}

std::optional<fs::path> ProjectFiles::locate(const fs::path& relative, bool allowLinkAtEnd) const {
    fs::path current = root_;
    for (auto part = relative.begin(); part != relative.end(); ++part) {
        current /= *part;
        const bool last = std::next(part) == relative.end();
        if (isLinkType(typeOf(current)) && !(last && allowLinkAtEnd)) return std::nullopt;
    }
    return current;
}

std::optional<fs::path> ProjectFiles::locateFolder(const fs::path& folder) const {
    auto located = locate(folder, /*allowLinkAtEnd=*/false);
    if (!located || !isFolder(*located)) return std::nullopt;
    return located;
}

Listing ProjectFiles::list(const fs::path& folder) const {
    Listing listing;
    const auto located = locateFolder(folder);
    if (!located) {
        listing.missing = true;
        return listing;
    }

    struct Item {
        std::wstring name;
        EntryKind kind;
    };
    std::vector<Item> items;
    std::error_code ec;
    for (fs::directory_iterator it(*located, ec), end; !ec && it != end; it.increment(ec)) {
        std::wstring name = it->path().filename().wstring();
        if (domain::isHiddenName(name)) continue;
        std::error_code statusError;
        const auto type = it->symlink_status(statusError).type();
        const EntryKind kind = isLinkType(type)                      ? EntryKind::Link
                               : type == fs::file_type::directory ? EntryKind::Folder
                                                                  : EntryKind::File;
        items.push_back({std::move(name), kind});
    }
    if (ec) {
        listing.missing = true;
        return listing;
    }

    std::sort(items.begin(), items.end(), [](const Item& a, const Item& b) {
        return domain::listedBefore(a.kind != EntryKind::File, a.name, b.kind != EntryKind::File,
                                    b.name);
    });
    for (const auto& item : items) {
        listing.entries.push_back({domain::toUtf8(fs::path(item.name)), item.kind});
    }
    listing.stamp = stampOf(listing.entries);
    return listing;
}

FileText ProjectFiles::read(const fs::path& file, const std::string& knownStamp) const {
    FileText result;
    const auto located = file.empty() ? std::nullopt : locate(file, /*allowLinkAtEnd=*/false);
    if (!located || !present(*located)) {
        result.error = "not_found";
        return result;
    }
    if (typeOf(*located) != fs::file_type::regular) {
        result.error = "not_file";
        return result;
    }
    std::error_code ec;
    const auto size = fs::file_size(*located, ec);
    const auto time = ec ? fs::file_time_type{} : fs::last_write_time(*located, ec);
    if (ec) {
        result.error = "not_found";
        return result;
    }
    result.stamp = std::to_string(time.time_since_epoch().count()) + "-" + std::to_string(size);
    if (size > kLargestTextFile) {
        result.error = "too_large";
        return result;
    }
    if (result.stamp == knownStamp) {
        result.unchanged = true;
        return result;
    }

    std::ifstream input(*located, std::ios::binary);
    if (!input) {
        result.error = "failed";
        return result;
    }
    std::string bytes((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    if (bytes.size() > kLargestTextFile) {
        result.error = "too_large";
        return result;
    }
    if (!domain::isUtf8Text(bytes)) {
        result.error = "not_text";
        return result;
    }
    // 파일 맨 앞의 UTF-8 표시는 내용이 아니다
    if (bytes.rfind("\xEF\xBB\xBF", 0) == 0) bytes.erase(0, 3);
    result.text = std::move(bytes);
    return result;
}

Outcome ProjectFiles::move(const std::vector<fs::path>& items, const fs::path& toFolder) {
    const auto destination = locateFolder(toFolder);
    if (!destination) return {"not_found", {}};

    struct Step {
        fs::path from;
        fs::path to;
        FileChange change;
    };
    std::vector<Step> steps;
    for (const auto& item : domain::dropNested(items)) {
        if (item.empty()) return {"invalid_path", {}};
        const auto source = locate(item, /*allowLinkAtEnd=*/true);
        if (!source || !present(*source)) return {"not_found", {}};
        if (domain::isSameOrInside(toFolder, item)) return {"into_itself", {}};
        if (domain::samePath(item.parent_path(), toFolder)) continue;  // 이미 그 폴더에 있다

        const fs::path target = toFolder / item.filename();
        const bool clash = std::any_of(steps.begin(), steps.end(), [&](const Step& step) {
            return domain::samePath(step.change.to, target);
        });
        if (clash || present(*destination / item.filename())) return {"name_taken", {}};
        steps.push_back({*source, *destination / item.filename(), {item, target}});
    }

    Outcome outcome;
    for (std::size_t done = 0; done < steps.size(); ++done) {
        const DWORD error = moveNoReplace(steps[done].from, steps[done].to);
        if (error != ERROR_SUCCESS) {
            for (std::size_t back = done; back-- > 0;) {
                moveNoReplace(steps[back].to, steps[back].from);
            }
            return {errorCode(error), {}};
        }
        outcome.changes.push_back(steps[done].change);
    }
    return outcome;
}

Outcome ProjectFiles::copy(const std::vector<fs::path>& items, const fs::path& toFolder) {
    const auto destination = locateFolder(toFolder);
    if (!destination) return {"not_found", {}};

    const auto sources = domain::dropNested(items);
    for (const auto& item : sources) {
        if (item.empty()) return {"invalid_path", {}};
        const auto source = locate(item, /*allowLinkAtEnd=*/true);
        if (!source || !present(*source)) return {"not_found", {}};
        if (domain::isSameOrInside(toFolder, item)) return {"into_itself", {}};
    }

    Outcome outcome;
    std::vector<fs::path> created;
    for (const auto& item : sources) {
        const fs::path source = root_ / item;
        std::wstring name = item.filename().wstring();
        if (present(*destination / name)) {
            name = domain::copyName(name, isFolder(source), [&](const std::wstring& candidate) {
                return present(*destination / candidate);
            });
        }
        const fs::path target = *destination / name;
        created.push_back(target);
        const DWORD error = copyTree(source, target);
        if (error != ERROR_SUCCESS) {
            // 만들다 만 사본을 남기지 않는다
            std::vector<fs::path> leftovers;
            for (const auto& path : created) {
                if (present(path)) leftovers.push_back(path);
            }
            if (!leftovers.empty()) trash_(leftovers);
            return {errorCode(error), {}};
        }
        outcome.changes.push_back({{}, toFolder / name});
    }
    return outcome;
}

Outcome ProjectFiles::rename(const fs::path& item, const std::wstring& newName) {
    if (item.empty()) return {"invalid_path", {}};
    if (domain::checkName(newName) != domain::NameProblem::None || domain::isHiddenName(newName)) {
        return {"invalid_name", {}};
    }
    const auto source = locate(item, /*allowLinkAtEnd=*/true);
    if (!source || !present(*source)) return {"not_found", {}};

    const std::wstring oldName = item.filename().wstring();
    if (oldName == newName) return {};
    const fs::path target = item.parent_path() / newName;
    const fs::path targetPath = source->parent_path() / newName;
    // 대소문자만 바꾸는 것은 같은 파일이므로 겹침이 아니다
    const bool caseOnly = domain::samePath(item, target);
    if (!caseOnly && present(targetPath)) return {"name_taken", {}};

    const DWORD error = moveNoReplace(*source, targetPath);
    if (error != ERROR_SUCCESS) return {errorCode(error), {}};
    return {{}, {{item, target}}};
}

Outcome ProjectFiles::create(const fs::path& parent, const std::wstring& name, bool folder) {
    if (domain::checkName(name) != domain::NameProblem::None || domain::isHiddenName(name)) {
        return {"invalid_name", {}};
    }
    const auto directory = locateFolder(parent);
    if (!directory) return {"not_found", {}};
    const fs::path target = *directory / name;
    if (present(target)) return {"name_taken", {}};

    if (folder) {
        if (!CreateDirectoryW(target.c_str(), nullptr)) return {errorCode(GetLastError()), {}};
    } else {
        const HANDLE file = CreateFileW(target.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                                        FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file == INVALID_HANDLE_VALUE) return {errorCode(GetLastError()), {}};
        CloseHandle(file);
    }
    return {{}, {{{}, parent / name}}};
}

Outcome ProjectFiles::trash(const std::vector<fs::path>& items) {
    std::vector<fs::path> targets;
    Outcome outcome;
    for (const auto& item : domain::dropNested(items)) {
        if (item.empty()) return {"invalid_path", {}};
        const auto located = locate(item, /*allowLinkAtEnd=*/true);
        if (!located || !present(*located)) return {"not_found", {}};
        targets.push_back(*located);
        outcome.changes.push_back({item, {}});
    }
    if (targets.empty()) return {};
    std::string error = trash_(targets);
    if (!error.empty()) return {std::move(error), {}};
    return outcome;
}

Outcome ProjectFiles::moveBack(const std::vector<FileChange>& changes) {
    struct Step {
        fs::path from;
        fs::path to;
    };
    std::vector<Step> steps;
    for (const auto& change : changes) {
        const auto current = locate(change.to, /*allowLinkAtEnd=*/true);
        if (!current || !present(*current)) return {"undo_missing", {}};
        const auto original = locate(change.from, /*allowLinkAtEnd=*/true);
        if (!original || !isFolder(original->parent_path())) return {"undo_missing", {}};
        const bool caseOnly = domain::samePath(change.from, change.to);
        if (!caseOnly && present(*original)) return {"undo_name_taken", {}};
        steps.push_back({*current, *original});
    }
    for (std::size_t done = 0; done < steps.size(); ++done) {
        const DWORD error = moveNoReplace(steps[done].from, steps[done].to);
        if (error != ERROR_SUCCESS) {
            for (std::size_t back = done; back-- > 0;) {
                moveNoReplace(steps[back].to, steps[back].from);
            }
            return {errorCode(error), {}};
        }
    }
    return {{}, changes};
}

Outcome ProjectFiles::undo(const domain::FileOperation& operation) {
    switch (operation.kind) {
        case domain::FileOperationKind::Move:
        case domain::FileOperationKind::Rename:
            return moveBack(operation.items);
        case domain::FileOperationKind::Create:
        case domain::FileOperationKind::Copy: {
            std::vector<fs::path> targets;
            for (const auto& change : operation.items) {
                const auto located = locate(change.to, /*allowLinkAtEnd=*/true);
                if (!located || !present(*located)) return {"undo_missing", {}};
                targets.push_back(*located);
            }
            std::string error = trash_(targets);
            if (!error.empty()) return {std::move(error), {}};
            return {{}, operation.items};
        }
    }
    return {"failed", {}};
}

}  // namespace va::data
