# Visual-Agent

에이전트와 기획자가 함께 일하기 위한 가벼운 개인용 IDE.

- 프로젝트마다 탭 하나. 탭 안에서는 그 프로젝트의 에이전트만 하이어라키로 본다.
- 에이전트의 답변은 터미널 글이 아니라 문서 창으로 받는다. 문장에 형광펜을 칠하고 메모를 붙여 세부 지시를 한다.
- 기능은 필요할 때 명세 하나씩으로 추가한다.

## 상태

앱 뼈대까지 만들었다. 실행하면 프로젝트 탭이 있는 빈 작업 화면이 열린다. 에이전트 실행, 문서 창, 코드 편집기는 아직 없다.

## 구조

```
core/      코어 (C++20). 프로젝트 탭 규칙, 개인 설정 저장, 앱 안의 웹 서버, 앱 창
ui/        화면 (TypeScript + React). 앱 창 안의 WebView2에서 열린다
design/    기린 테마 색상표
scripts/   빌드·검사·증적 수집 스크립트
.season0/  설정, 기능 맵, 결정 기록, 명세 양식
private/   명세와 개인 내용 (별도 비공개 저장소, 이 저장소에 포함되지 않음)
```

결정의 이유는 `.season0/decisions/`에 있다.

## 빌드와 실행

Windows 11 기준. Visual Studio Build Tools 2022(C++와 CMake 도구), [vcpkg](https://github.com/microsoft/vcpkg)(`%USERPROFILE%\vcpkg` 또는 `VCPKG_ROOT`), Node.js가 필요하다.

```
cd ui && npm install && cd ..
npm run build     # build/dist/Visual-Agent/ 에 실행 파일과 화면 파일이 만들어진다
npm start
npm run check     # 품질 게이트: 린트, 테스트, 빌드, 실제 앱 창 테스트
```

다른 Windows PC에서 쓰려면 `build/dist/Visual-Agent` 폴더를 통째로 복사한다.

## 작업 방식

[Season0 Framework](AGENTS.md)를 따른다: 원문 요청 → 명세 → 사람 승인 → 구현 → 증적 기반 검증.
