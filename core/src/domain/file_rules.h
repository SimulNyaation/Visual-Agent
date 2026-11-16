// 파일 칸의 규칙: 이름 검사, 프로젝트 안 경로 해석, 정렬, 사본 이름, 되돌리기 기록.
// 파일 시스템, 창, 네트워크를 모른다.
#pragma once

#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace va::domain {

enum class NameProblem { None, Empty, InvalidCharacter, Reserved };

// Windows에서 파일·폴더 이름으로 쓸 수 있는지 확인한다
NameProblem checkName(const std::wstring& name);

// 파일 칸에 보이지 않고 건드릴 수도 없는 이름 (.git)
bool isHiddenName(const std::wstring& name);

// 화면이 보낸 "a/b/c" 꼴의 프로젝트 안 경로를 해석한다. 빈 글은 프로젝트 폴더 자신이다.
// 프로젝트 폴더 밖을 가리킬 수 있는 글(.., 드라이브 이름, 역슬래시 등)과 숨긴 이름은 값이 없다.
std::optional<std::filesystem::path> parseRelativePath(const std::string& text);

// 화면에 보내는 "a/b/c" 꼴
std::string toRelativeText(const std::filesystem::path& relative);

// 대소문자를 구분하지 않고 같은 경로인지
bool samePath(const std::filesystem::path& a, const std::filesystem::path& b);

// inner가 outer와 같거나 outer 안에 있는지 (둘 다 프로젝트 안 경로)
bool isSameOrInside(const std::filesystem::path& inner, const std::filesystem::path& outer);

// 다른 항목 안에 들어 있는 항목과 중복을 뺀다. 폴더와 그 안의 파일을 함께 골랐을 때 폴더만 남긴다
std::vector<std::filesystem::path> dropNested(const std::vector<std::filesystem::path>& items);

// 폴더 먼저, 그다음 이름순(대소문자 구분 없음)으로 앞에 오는지
bool listedBefore(bool aIsFolder, const std::wstring& aName, bool bIsFolder, const std::wstring& bName);

// 같은 이름이 있을 때 쓸 사본 이름. "이름 - 복사본.확장자", 그것도 있으면 "이름 - 복사본 (2).확장자" …
std::wstring copyName(const std::wstring& name, bool isFolder,
                      const std::function<bool(const std::wstring&)>& taken);

// 되돌릴 수 있는 파일 작업 하나
struct FileChange {
    std::filesystem::path from;  // 원래 자리. 새로 만들기와 복사에서는 비어 있다
    std::filesystem::path to;    // 지금 자리
};

enum class FileOperationKind { Move, Rename, Create, Copy };

struct FileOperation {
    FileOperationKind kind = FileOperationKind::Move;
    std::vector<FileChange> items;
};

const char* toText(FileOperationKind kind);

}  // namespace va::domain
