#include <doctest/doctest.h>

#include <cstdlib>
#include <fstream>
#include <sstream>

#include <windows.h>

#include "data/project_files.h"
#include "data/recycle_bin.h"
#include "temp_dir.h"

using va::data::EntryKind;
using va::data::ProjectFiles;
using va::domain::FileOperation;
using va::domain::FileOperationKind;
using Path = std::filesystem::path;
namespace fs = std::filesystem;

namespace {

void write(const Path& path, const std::string& content) {
    fs::create_directories(path.parent_path());
    std::ofstream(path, std::ios::binary) << content;
}

std::string read(const Path& path) {
    std::ifstream file(path, std::ios::binary);
    std::stringstream content;
    content << file.rdbuf();
    return content.str();
}

std::vector<std::string> names(const va::data::Listing& listing) {
    std::vector<std::string> result;
    for (const auto& entry : listing.entries) result.push_back(entry.name);
    return result;
}

// 다른 프로그램이 파일을 쓰고 있는 상황을 만든다
struct LockedFile {
    HANDLE handle;
    explicit LockedFile(const Path& path)
        : handle(CreateFileW(path.c_str(), GENERIC_READ, 0, nullptr, OPEN_EXISTING,
                             FILE_ATTRIBUTE_NORMAL, nullptr)) {
        REQUIRE(handle != INVALID_HANDLE_VALUE);
    }
    ~LockedFile() { CloseHandle(handle); }
};

struct Project {
    va::test::TempDir dir;
    Path root = dir.path() / "project";
    Path trashed = dir.path() / "trash";
    Path outside = dir.path() / "outside";
    ProjectFiles files{root, va::data::folderTrash(trashed)};

    Project() {
        write(root / "readme.md", "readme");
        write(root / "Zeta.txt", "zeta");
        write(root / "src" / "main.cpp", "main");
        write(root / "src" / "util" / "text.cpp", "text");
        write(root / "docs" / "guide.md", "guide");
        write(root / ".git" / "config", "git");
        write(outside / "secret.txt", "secret");
    }

    std::size_t trashCount() const {
        std::error_code ec;
        std::size_t count = 0;
        for (fs::directory_iterator it(trashed, ec), end; !ec && it != end; it.increment(ec)) ++count;
        return count;
    }
};

}  // namespace

TEST_CASE_FIXTURE(Project, "폴더가 먼저, 그다음 파일이 이름순으로 나오고 .git은 빠진다 (AC3)") {
    const auto listing = files.list({});
    CHECK_FALSE(listing.missing);
    CHECK(names(listing) == std::vector<std::string>{"docs", "src", "readme.md", "Zeta.txt"});
    CHECK(listing.entries[0].kind == EntryKind::Folder);
    CHECK(listing.entries[2].kind == EntryKind::File);

    CHECK(names(files.list(Path(L"src"))) == std::vector<std::string>{"util", "main.cpp"});
    CHECK(files.list(Path(L"nope")).missing);
    CHECK(files.list(Path(L"readme.md")).missing);
}

TEST_CASE_FIXTURE(Project, "폴더 내용이 바뀌면 stamp가 달라진다 (AC6)") {
    const auto before = files.list({}).stamp;
    CHECK(files.list({}).stamp == before);
    write(root / "new.txt", "");
    CHECK(files.list({}).stamp != before);
}

TEST_CASE_FIXTURE(Project, "파일과 폴더를 다른 폴더로 옮긴다 (AC12, AC13)") {
    const auto outcome = files.move({Path(L"readme.md"), Path(L"src")}, Path(L"docs"));
    CHECK(outcome.error.empty());
    CHECK(outcome.changes.size() == 2);
    CHECK(read(root / "docs" / "readme.md") == "readme");
    CHECK(read(root / "docs" / "src" / "util" / "text.cpp") == "text");
    CHECK_FALSE(fs::exists(root / "readme.md"));
    CHECK_FALSE(fs::exists(root / "src"));
}

TEST_CASE_FIXTURE(Project, "프로젝트 폴더 바로 아래로 옮긴다 (AC14)") {
    CHECK(files.move({Path(L"src") / L"main.cpp"}, {}).error.empty());
    CHECK(read(root / "main.cpp") == "main");
}

TEST_CASE_FIXTURE(Project, "같은 이름이 있으면 하나도 옮기지 않고 기존 내용은 그대로다 (AC15)") {
    write(root / "docs" / "readme.md", "other");

    const auto outcome = files.move({Path(L"Zeta.txt"), Path(L"readme.md")}, Path(L"docs"));

    CHECK(outcome.error == "name_taken");
    CHECK(read(root / "docs" / "readme.md") == "other");
    CHECK(read(root / "readme.md") == "readme");
    CHECK(read(root / "Zeta.txt") == "zeta");
    CHECK_FALSE(fs::exists(root / "docs" / "Zeta.txt"));
}

TEST_CASE_FIXTURE(Project, "이름이 같은 두 항목을 한 폴더로 옮기려 하면 하나도 옮기지 않는다 (AC15)") {
    write(root / "src" / "readme.md", "second");
    const auto outcome = files.move({Path(L"readme.md"), Path(L"src") / L"readme.md"}, Path(L"docs"));
    CHECK(outcome.error == "name_taken");
    CHECK(read(root / "readme.md") == "readme");
    CHECK(read(root / "src" / "readme.md") == "second");
}

TEST_CASE_FIXTURE(Project, "폴더를 자기 자신이나 자기 안으로는 옮길 수 없다 (AC16)") {
    CHECK(files.move({Path(L"src")}, Path(L"src")).error == "into_itself");
    CHECK(files.move({Path(L"src")}, Path(L"src") / L"util").error == "into_itself");
    CHECK(read(root / "src" / "util" / "text.cpp") == "text");
}

TEST_CASE_FIXTURE(Project, "이미 그 폴더에 있는 것을 옮기면 아무 일도 없다") {
    const auto outcome = files.move({Path(L"src") / L"main.cpp"}, Path(L"src"));
    CHECK(outcome.error.empty());
    CHECK(outcome.changes.empty());
}

TEST_CASE_FIXTURE(Project, "다른 프로그램이 쓰는 파일은 옮기기·이름 바꾸기·지우기가 되지 않고 그대로 남는다 (AC26)") {
    const LockedFile lock(root / "readme.md");

    CHECK(files.move({Path(L"Zeta.txt"), Path(L"readme.md")}, Path(L"docs")).error == "in_use");
    CHECK(fs::exists(root / "Zeta.txt"));
    CHECK_FALSE(fs::exists(root / "docs" / "Zeta.txt"));

    CHECK(files.rename(Path(L"readme.md"), L"renamed.md").error == "in_use");
    CHECK(files.trash({Path(L"readme.md")}).error == "in_use");
    CHECK(fs::exists(root / "readme.md"));
}

TEST_CASE_FIXTURE(Project, "이름을 바꾼다 (AC18)") {
    CHECK(files.rename(Path(L"src") / L"main.cpp", L"app.cpp").error.empty());
    CHECK(read(root / "src" / "app.cpp") == "main");
    CHECK_FALSE(fs::exists(root / "src" / "main.cpp"));

    CHECK(files.rename(Path(L"docs"), L"manual").error.empty());
    CHECK(read(root / "manual" / "guide.md") == "guide");
}

TEST_CASE_FIXTURE(Project, "대소문자만 바꾸는 이름 바꾸기는 겹침이 아니다") {
    CHECK(files.rename(Path(L"readme.md"), L"README.md").error.empty());
    CHECK(names(files.list({}))[2] == "README.md");
}

TEST_CASE_FIXTURE(Project, "이미 있는 이름이나 쓸 수 없는 글자로는 이름이 바뀌지 않는다 (AC19)") {
    CHECK(files.rename(Path(L"readme.md"), L"Zeta.txt").error == "name_taken");
    CHECK(files.rename(Path(L"readme.md"), L"a?b.md").error == "invalid_name");
    CHECK(files.rename(Path(L"readme.md"), L"").error == "invalid_name");
    CHECK(files.rename(Path(L"readme.md"), L".git").error == "invalid_name");
    CHECK(read(root / "readme.md") == "readme");
    CHECK(read(root / "Zeta.txt") == "zeta");
}

TEST_CASE_FIXTURE(Project, "새 파일과 새 폴더를 만든다 (AC20)") {
    CHECK(files.create(Path(L"src"), L"new.ts", false).error.empty());
    CHECK(fs::is_regular_file(root / "src" / "new.ts"));
    CHECK(fs::file_size(root / "src" / "new.ts") == 0);

    CHECK(files.create({}, L"assets", true).error.empty());
    CHECK(fs::is_directory(root / "assets"));

    CHECK(files.create({}, L"readme.md", false).error == "name_taken");
    CHECK(files.create({}, L"", false).error == "invalid_name");
    CHECK(read(root / "readme.md") == "readme");
}

TEST_CASE_FIXTURE(Project, "지우면 휴지통으로 간다 (AC21, AC22)") {
    const auto outcome = files.trash({Path(L"readme.md"), Path(L"src"), Path(L"src") / L"main.cpp"});
    CHECK(outcome.error.empty());
    CHECK_FALSE(fs::exists(root / "readme.md"));
    CHECK_FALSE(fs::exists(root / "src"));
    CHECK(trashCount() == 2);
}

TEST_CASE_FIXTURE(Project, "복사하면 같은 내용의 사본이 생기고 원래 것은 남는다 (AC29)") {
    const auto outcome = files.copy({Path(L"readme.md"), Path(L"src")}, Path(L"docs"));
    CHECK(outcome.error.empty());
    CHECK(read(root / "docs" / "readme.md") == "readme");
    CHECK(read(root / "docs" / "src" / "util" / "text.cpp") == "text");
    CHECK(read(root / "readme.md") == "readme");
    CHECK(read(root / "src" / "util" / "text.cpp") == "text");
}

TEST_CASE_FIXTURE(Project, "같은 이름이 있는 곳에 복사하면 덮어쓰지 않고 복사본 이름으로 만든다 (AC32)") {
    auto outcome = files.copy({Path(L"readme.md")}, {});
    CHECK(outcome.error.empty());
    CHECK(outcome.changes[0].to == Path(L"readme - 복사본.md"));
    outcome = files.copy({Path(L"readme.md")}, {});
    CHECK(outcome.changes[0].to == Path(L"readme - 복사본 (2).md"));
    outcome = files.copy({Path(L"src")}, {});
    CHECK(outcome.changes[0].to == Path(L"src - 복사본"));

    CHECK(read(root / L"readme - 복사본.md") == "readme");
    CHECK(read(root / L"readme - 복사본 (2).md") == "readme");
    CHECK(read(root / L"src - 복사본" / "util" / "text.cpp") == "text");
    CHECK(read(root / "readme.md") == "readme");
}

TEST_CASE_FIXTURE(Project, "폴더를 자기 안에 복사할 수 없다 (AC34)") {
    CHECK(files.copy({Path(L"src")}, Path(L"src") / L"util").error == "into_itself");
    CHECK(names(files.list(Path(L"src") / L"util")) == std::vector<std::string>{"text.cpp"});
}

TEST_CASE_FIXTURE(Project, "옮기기·이름 바꾸기를 되돌리면 원래 자리로 돌아간다 (AC23)") {
    const auto moved = files.move({Path(L"readme.md"), Path(L"Zeta.txt")}, Path(L"docs"));
    CHECK(files.undo({FileOperationKind::Move, moved.changes}).error.empty());
    CHECK(read(root / "readme.md") == "readme");
    CHECK(read(root / "Zeta.txt") == "zeta");
    CHECK_FALSE(fs::exists(root / "docs" / "readme.md"));

    const auto renamed = files.rename(Path(L"readme.md"), L"intro.md");
    CHECK(files.undo({FileOperationKind::Rename, renamed.changes}).error.empty());
    CHECK(read(root / "readme.md") == "readme");
}

TEST_CASE_FIXTURE(Project, "새로 만든 것과 붙여넣은 사본을 되돌리면 휴지통으로 간다 (AC23)") {
    const auto created = files.create({}, L"new.txt", false);
    CHECK(files.undo({FileOperationKind::Create, created.changes}).error.empty());
    CHECK_FALSE(fs::exists(root / "new.txt"));
    CHECK(trashCount() == 1);

    const auto copied = files.copy({Path(L"src")}, Path(L"docs"));
    CHECK(files.undo({FileOperationKind::Copy, copied.changes}).error.empty());
    CHECK_FALSE(fs::exists(root / "docs" / "src"));
    CHECK(fs::exists(root / "src"));
    CHECK(trashCount() == 2);
}

TEST_CASE_FIXTURE(Project, "그 사이 밖에서 바뀌어 되돌릴 수 없으면 아무것도 바꾸지 않는다 (AC25)") {
    SUBCASE("원래 자리에 같은 이름이 생김") {
        const auto moved = files.move({Path(L"readme.md"), Path(L"Zeta.txt")}, Path(L"docs"));
        write(root / "readme.md", "newer");
        CHECK(files.undo({FileOperationKind::Move, moved.changes}).error == "undo_name_taken");
        CHECK(read(root / "readme.md") == "newer");
        CHECK(read(root / "docs" / "readme.md") == "readme");
        CHECK(read(root / "docs" / "Zeta.txt") == "zeta");
    }
    SUBCASE("옮긴 파일이 없어짐") {
        const auto moved = files.move({Path(L"readme.md")}, Path(L"docs"));
        fs::remove(root / "docs" / "readme.md");
        CHECK(files.undo({FileOperationKind::Move, moved.changes}).error == "undo_missing");
    }
    SUBCASE("새로 만든 파일이 없어짐") {
        const auto created = files.create({}, L"new.txt", false);
        fs::remove(root / "new.txt");
        CHECK(files.undo({FileOperationKind::Create, created.changes}).error == "undo_missing");
        CHECK(trashCount() == 0);
    }
}

TEST_CASE_FIXTURE(Project, "프로젝트 폴더 밖으로 이어지는 연결 폴더는 표시만 하고 따라 들어가지 않는다 (AC27)") {
    const std::wstring command = L"cmd /c mklink /J \"" + (root / "link").wstring() + L"\" \"" +
                                 outside.wstring() + L"\" >nul";
    REQUIRE(_wsystem(command.c_str()) == 0);

    const auto listing = files.list({});
    REQUIRE(names(listing)[1] == "link");
    CHECK(listing.entries[1].kind == EntryKind::Link);

    CHECK(files.list(Path(L"link")).missing);
    CHECK(files.move({Path(L"readme.md")}, Path(L"link")).error == "not_found");
    CHECK(files.copy({Path(L"readme.md")}, Path(L"link")).error == "not_found");
    CHECK(files.create(Path(L"link"), L"x.txt", false).error == "not_found");
    CHECK(files.move({Path(L"link") / L"secret.txt"}, {}).error == "not_found");
    CHECK(files.trash({Path(L"link") / L"secret.txt"}).error == "not_found");
    CHECK(files.rename(Path(L"link") / L"secret.txt", L"x.txt").error == "not_found");
    CHECK(files.copy({Path(L"link")}, Path(L"docs")).error == "contains_link");

    CHECK(read(outside / "secret.txt") == "secret");
    CHECK(names(files.list(Path(L"docs"))) == std::vector<std::string>{"guide.md"});
    CHECK(fs::exists(root / "readme.md"));

    // 연결 폴더 자체를 지워야 임시 폴더를 치울 때 바깥 파일이 딸려 지워지지 않는다
    RemoveDirectoryW((root / "link").c_str());
}

// 실제 Windows 휴지통을 쓴다. 돌릴 때마다 휴지통에 파일이 하나 남으므로 품질 게이트에서는 건너뛴다.
// 실행: va_tests.exe -tc="recycle-bin-real*" --no-skip
TEST_CASE("recycle-bin-real: 지운 파일은 Windows 휴지통으로 가고, 쓰는 중인 파일은 지워지지 않는다 (AC21, AC26)" *
          doctest::skip()) {
    va::test::TempDir dir;
    const Path file = dir.path() / "va-recycle-check.txt";
    const Path busy = dir.path() / "va-recycle-busy.txt";
    const Path folder = dir.path() / "va-recycle-folder";
    write(file, "recycle me");
    write(busy, "busy");
    write(folder / "inside.txt", "inside");

    const auto trash = va::data::recycleBinTrash();
    CHECK(trash({file, folder}).empty());
    CHECK_FALSE(fs::exists(file));
    CHECK_FALSE(fs::exists(folder));

    {
        const LockedFile lock(busy);
        CHECK(trash({busy}) == "in_use");
        CHECK(fs::exists(busy));
    }
}

TEST_CASE("문서 창: 글자 파일의 내용을 읽고, 바뀌지 않았으면 내용 없이 알린다 (AC1, AC7)") {
    va::test::TempDir dir;
    write(dir.path() / "docs" / "plan.md", "# \xEA\xB3\x84\xED\x9A\x8D\n");
    write(dir.path() / "bom.txt", "\xEF\xBB\xBFhello");
    ProjectFiles files(dir.path(), va::data::folderTrash(dir.path() / ".trash"));

    const auto first = files.read("docs/plan.md", "");
    CHECK(first.error.empty());
    CHECK(first.text == "# \xEA\xB3\x84\xED\x9A\x8D\n");
    CHECK_FALSE(first.stamp.empty());
    CHECK(files.read("bom.txt", "").text == "hello");

    const auto same = files.read("docs/plan.md", first.stamp);
    CHECK(same.unchanged);
    CHECK(same.text.empty());

    write(dir.path() / "docs" / "plan.md", "# changed and longer\n");
    const auto changed = files.read("docs/plan.md", first.stamp);
    CHECK_FALSE(changed.unchanged);
    CHECK(changed.text == "# changed and longer\n");
    CHECK(changed.stamp != first.stamp);
}

TEST_CASE("문서 창: 열 수 없는 파일은 이유를 알린다 (AC11, AC15)") {
    va::test::TempDir dir;
    const Path root = dir.path() / "project";
    write(root / "image.png", std::string("\x89PNG\r\n\x1a\n\0\0\0", 11));
    write(root / "big.log", std::string(va::data::kLargestTextFile + 1, 'x'));
    write(root / "edge.log", std::string(va::data::kLargestTextFile, 'x'));
    write(root / "sub" / "a.txt", "a");
    write(dir.path() / "outside.txt", "secret");
    ProjectFiles files(root, va::data::folderTrash(dir.path() / ".trash"));

    CHECK(files.read("image.png", "").error == "not_text");
    CHECK(files.read("big.log", "").error == "too_large");
    CHECK(files.read("edge.log", "").error.empty());
    CHECK(files.read("ghost.txt", "").error == "not_found");
    CHECK(files.read("sub", "").error == "not_file");
    CHECK(files.read("", "").error == "not_found");

    // 프로젝트 폴더 밖으로 이어지는 연결 폴더를 거쳐서는 읽지 못한다
    std::error_code ec;
    fs::create_directory_symlink(dir.path(), root / "link", ec);
    if (!ec) CHECK(files.read("link/outside.txt", "").error == "not_found");
}
