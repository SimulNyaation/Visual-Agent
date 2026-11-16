// 프로젝트 폴더 안의 파일을 읽고 옮기고 복사하고 이름을 바꾸고 만든다.
// 프로젝트 폴더 밖은 건드리지 않고, 이미 있는 파일을 덮어쓰지 않는다.
#pragma once

#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "domain/file_rules.h"

namespace va::data {

// 파일·폴더를 휴지통으로 보낸다. 성공하면 빈 글, 실패하면 오류 코드("no_trash", "in_use", "failed")
using TrashFn = std::function<std::string(const std::vector<std::filesystem::path>&)>;

enum class EntryKind { Folder, File, Link };

struct FileEntry {
    std::string name;
    EntryKind kind = EntryKind::File;
};

struct Listing {
    bool missing = false;  // 폴더가 없거나 읽을 수 없음
    std::string stamp;     // 내용이 같으면 같은 값. 바뀌었는지 비교하는 데 쓴다
    std::vector<FileEntry> entries;
};

// 작업 결과. error가 비어 있으면 성공이고 changes에 바뀐 내용이 담긴다
struct Outcome {
    std::string error;
    std::vector<domain::FileChange> changes;
};

class ProjectFiles {
public:
    ProjectFiles(std::filesystem::path root, TrashFn trash);

    Listing list(const std::filesystem::path& folder) const;

    // 모두 옮기거나 하나도 옮기지 않는다
    Outcome move(const std::vector<std::filesystem::path>& items, const std::filesystem::path& toFolder);
    // 같은 이름이 있으면 "이름 - 복사본"으로 만든다
    Outcome copy(const std::vector<std::filesystem::path>& items, const std::filesystem::path& toFolder);
    Outcome rename(const std::filesystem::path& item, const std::wstring& newName);
    Outcome create(const std::filesystem::path& parent, const std::wstring& name, bool folder);
    Outcome trash(const std::vector<std::filesystem::path>& items);
    Outcome undo(const domain::FileOperation& operation);

    // 폴더의 실제 위치. 프로젝트 폴더 밖으로 이어지는 연결 폴더를 거치면 값이 없다
    std::optional<std::filesystem::path> locateFolder(const std::filesystem::path& folder) const;

private:
    std::optional<std::filesystem::path> locate(const std::filesystem::path& relative,
                                                bool allowLinkAtEnd) const;
    Outcome moveBack(const std::vector<domain::FileChange>& changes);

    std::filesystem::path root_;
    TrashFn trash_;
};

}  // namespace va::data
