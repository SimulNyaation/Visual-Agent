#include <doctest/doctest.h>

#include <set>

#include "domain/file_rules.h"

using namespace va::domain;
using Path = std::filesystem::path;

TEST_CASE("Windows에서 쓸 수 없는 이름을 가려낸다 (AC19)") {
    CHECK(checkName(L"notes.md") == NameProblem::None);
    CHECK(checkName(L"한글 이름.txt") == NameProblem::None);
    CHECK(checkName(L".env") == NameProblem::None);
    CHECK(checkName(L"") == NameProblem::Empty);
    for (const wchar_t* bad : {L"a\\b", L"a/b", L"a:b", L"a*b", L"a?b", L"a\"b", L"a<b", L"a>b", L"a|b"}) {
        CHECK(checkName(bad) == NameProblem::InvalidCharacter);
    }
    CHECK(checkName(L".") == NameProblem::Reserved);
    CHECK(checkName(L"..") == NameProblem::Reserved);
    CHECK(checkName(L"name.") == NameProblem::Reserved);
    CHECK(checkName(L"name ") == NameProblem::Reserved);
    CHECK(checkName(L"CON") == NameProblem::Reserved);
    CHECK(checkName(L"nul.txt") == NameProblem::Reserved);
    CHECK(checkName(L"COM1") == NameProblem::Reserved);
    CHECK(checkName(L"common") == NameProblem::None);
}

TEST_CASE("프로젝트 폴더 밖을 가리킬 수 있는 경로는 받아들이지 않는다 (AC27)") {
    CHECK(parseRelativePath("") == Path());
    CHECK(parseRelativePath("src/app/main.cpp") == Path(L"src") / L"app" / L"main.cpp");

    for (const char* unsafe : {"..", "../outside", "src/../../outside", "/abs", "C:/Windows",
                               "C:", "src\\..\\..", "src//a", "src/", "./a", "a/./b"}) {
        CAPTURE(unsafe);
        CHECK_FALSE(parseRelativePath(unsafe).has_value());
    }
}

TEST_CASE(".git은 숨긴 이름이고 경로로도 가리킬 수 없다") {
    CHECK(isHiddenName(L".git"));
    CHECK(isHiddenName(L".GIT"));
    CHECK_FALSE(isHiddenName(L".gitignore"));
    CHECK_FALSE(parseRelativePath(".git/config").has_value());
    CHECK_FALSE(parseRelativePath("sub/.git").has_value());
    CHECK(parseRelativePath(".gitignore").has_value());
}

TEST_CASE("자기 자신이나 자기 안인지 판정한다 (AC16)") {
    CHECK(isSameOrInside(Path(L"a") / L"b", Path(L"a")));
    CHECK(isSameOrInside(Path(L"a"), Path(L"a")));
    CHECK(isSameOrInside(Path(L"A") / L"b", Path(L"a")));
    CHECK_FALSE(isSameOrInside(Path(L"ab"), Path(L"a")));
    CHECK_FALSE(isSameOrInside(Path(L"a"), Path(L"a") / L"b"));
    CHECK(isSameOrInside(Path(L"a"), Path()));
}

TEST_CASE("폴더와 그 안의 것을 함께 고르면 폴더만 남긴다 (AC13)") {
    const auto kept = dropNested({Path(L"a") / L"x.txt", Path(L"a"), Path(L"b.txt"), Path(L"B.TXT")});
    REQUIRE(kept.size() == 2);
    CHECK(kept[0] == Path(L"a"));
    CHECK(kept[1] == Path(L"b.txt"));
}

TEST_CASE("폴더가 먼저, 그다음 이름순이다 (AC3)") {
    CHECK(listedBefore(true, L"zeta", false, L"alpha.txt"));
    CHECK_FALSE(listedBefore(false, L"alpha.txt", true, L"zeta"));
    CHECK(listedBefore(false, L"Apple", false, L"banana"));
    CHECK(listedBefore(false, L"apple", false, L"Banana"));
}

TEST_CASE("같은 이름이 있으면 사본 이름을 만든다 (AC32)") {
    std::set<std::wstring> existing{L"report.txt"};
    const auto taken = [&](const std::wstring& name) { return existing.count(name) > 0; };

    CHECK(copyName(L"report.txt", false, taken) == L"report - 복사본.txt");
    existing.insert(L"report - 복사본.txt");
    CHECK(copyName(L"report.txt", false, taken) == L"report - 복사본 (2).txt");
    existing.insert(L"report - 복사본 (2).txt");
    CHECK(copyName(L"report.txt", false, taken) == L"report - 복사본 (3).txt");

    CHECK(copyName(L"assets.v2", true, taken) == L"assets.v2 - 복사본");
    CHECK(copyName(L"Makefile", false, taken) == L"Makefile - 복사본");
}
