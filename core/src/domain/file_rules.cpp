#include "domain/file_rules.h"

#include <algorithm>
#include <cwctype>
#include <exception>

#include "domain/project_tabs.h"

namespace va::domain {

namespace {

std::wstring lower(std::wstring text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    return text;
}

// Windows가 장치 이름으로 예약한 이름. 확장자를 붙여도 쓸 수 없다
bool isDeviceName(const std::wstring& name) {
    const std::wstring base = lower(name.substr(0, name.find(L'.')));
    if (base == L"con" || base == L"prn" || base == L"aux" || base == L"nul") return true;
    if (base.size() == 4 && (base.rfind(L"com", 0) == 0 || base.rfind(L"lpt", 0) == 0)) {
        return base[3] >= L'1' && base[3] <= L'9';
    }
    return false;
}

}  // namespace

NameProblem checkName(const std::wstring& name) {
    if (name.empty()) return NameProblem::Empty;
    for (const wchar_t c : name) {
        if (c < 32) return NameProblem::InvalidCharacter;
        switch (c) {
            case L'\\': case L'/': case L':': case L'*': case L'?':
            case L'"': case L'<': case L'>': case L'|':
                return NameProblem::InvalidCharacter;
            default:
                break;
        }
    }
    if (name == L"." || name == L"..") return NameProblem::Reserved;
    if (name.back() == L' ' || name.back() == L'.') return NameProblem::Reserved;
    if (isDeviceName(name)) return NameProblem::Reserved;
    return NameProblem::None;
}

bool isHiddenName(const std::wstring& name) { return lower(name) == L".git"; }

std::optional<std::filesystem::path> parseRelativePath(const std::string& text) {
    std::filesystem::path result;
    if (text.empty()) return result;

    std::size_t start = 0;
    for (;;) {
        const std::size_t slash = text.find('/', start);
        const std::size_t end = slash == std::string::npos ? text.size() : slash;
        std::wstring name;
        try {
            name = fromUtf8(text.substr(start, end - start)).wstring();
        } catch (const std::exception&) {
            return std::nullopt;
        }
        if (checkName(name) != NameProblem::None || isHiddenName(name)) return std::nullopt;
        result /= name;
        if (slash == std::string::npos) break;
        start = slash + 1;
    }
    return result;
}

std::string toRelativeText(const std::filesystem::path& relative) {
    const auto text = relative.generic_u8string();
    return std::string(text.begin(), text.end());
}

bool samePath(const std::filesystem::path& a, const std::filesystem::path& b) {
    return lower(a.generic_wstring()) == lower(b.generic_wstring());
}

bool isSameOrInside(const std::filesystem::path& inner, const std::filesystem::path& outer) {
    auto innerPart = inner.begin();
    for (auto outerPart = outer.begin(); outerPart != outer.end(); ++outerPart, ++innerPart) {
        if (innerPart == inner.end()) return false;
        if (lower(innerPart->wstring()) != lower(outerPart->wstring())) return false;
    }
    return true;
}

std::vector<std::filesystem::path> dropNested(const std::vector<std::filesystem::path>& items) {
    std::vector<std::filesystem::path> kept;
    for (const auto& item : items) {
        const bool covered = std::any_of(items.begin(), items.end(), [&](const auto& other) {
            return !samePath(item, other) && isSameOrInside(item, other);
        });
        const bool duplicate = std::any_of(kept.begin(), kept.end(),
                                           [&](const auto& other) { return samePath(item, other); });
        if (!covered && !duplicate) kept.push_back(item);
    }
    return kept;
}

bool listedBefore(bool aIsFolder, const std::wstring& aName, bool bIsFolder,
                  const std::wstring& bName) {
    if (aIsFolder != bIsFolder) return aIsFolder;
    const std::wstring a = lower(aName);
    const std::wstring b = lower(bName);
    if (a != b) return a < b;
    return aName < bName;
}

std::wstring copyName(const std::wstring& name, bool isFolder,
                      const std::function<bool(const std::wstring&)>& taken) {
    std::wstring stem = name;
    std::wstring extension;
    if (!isFolder) {
        const std::filesystem::path asPath(name);
        stem = asPath.stem().wstring();
        extension = asPath.extension().wstring();
    }
    const std::wstring first = stem + L" - 복사본" + extension;
    if (!taken(first)) return first;
    for (unsigned number = 2;; ++number) {
        const std::wstring next =
            stem + L" - 복사본 (" + std::to_wstring(number) + L")" + extension;
        if (!taken(next)) return next;
    }
}

const char* toText(FileOperationKind kind) {
    switch (kind) {
        case FileOperationKind::Move: return "move";
        case FileOperationKind::Rename: return "rename";
        case FileOperationKind::Create: return "create";
        case FileOperationKind::Copy: return "copy";
    }
    return "move";
}

}  // namespace va::domain

namespace va::domain {

bool isUtf8Text(const std::string& bytes) {
    std::size_t index = 0;
    while (index < bytes.size()) {
        const auto lead = static_cast<unsigned char>(bytes[index]);
        if (lead == 0) return false;
        std::size_t extra = 0;
        unsigned int code = 0;
        if (lead < 0x80) {
            ++index;
            continue;
        } else if (lead >= 0xC2 && lead <= 0xDF) {
            extra = 1;
            code = lead & 0x1Fu;
        } else if (lead >= 0xE0 && lead <= 0xEF) {
            extra = 2;
            code = lead & 0x0Fu;
        } else if (lead >= 0xF0 && lead <= 0xF4) {
            extra = 3;
            code = lead & 0x07u;
        } else {
            return false;
        }
        if (index + extra >= bytes.size()) return false;
        for (std::size_t offset = 1; offset <= extra; ++offset) {
            const auto next = static_cast<unsigned char>(bytes[index + offset]);
            if ((next & 0xC0u) != 0x80u) return false;
            code = (code << 6) | (next & 0x3Fu);
        }
        // 더 짧게 적을 수 있는 글자를 길게 적은 것, 글자가 아닌 값은 받지 않는다
        if (extra == 2 && (code < 0x800 || (code >= 0xD800 && code <= 0xDFFF))) return false;
        if (extra == 3 && (code < 0x10000 || code > 0x10FFFF)) return false;
        index += extra + 1;
    }
    return true;
}

}  // namespace va::domain
