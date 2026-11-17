cmake_minimum_required(VERSION 3.25)
project(VisualAgent LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
# 실행 파일만 복사해도 다른 PC에서 돌도록 런타임을 실행 파일 안에 넣는다
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_compile_options(/utf-8 /W4 /WX /permissive-)
add_compile_definitions(UNICODE _UNICODE NOMINMAX _WIN32_WINNT=0x0A00)

find_package(unofficial-webview2 CONFIG REQUIRED)
find_package(httplib CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(doctest CONFIG REQUIRED)
find_program(NODE_EXECUTABLE node REQUIRED)

# 색상표(design/theme-kirin.css)에서 창 쪽 색 상수를 만든다
set(THEME_CSS "${CMAKE_SOURCE_DIR}/../design/theme-kirin.css")
set(GENERATED_DIR "${CMAKE_BINARY_DIR}/generated")
add_custom_command(
  OUTPUT "${GENERATED_DIR}/theme_kirin.gen.h"
  COMMAND "${NODE_EXECUTABLE}" "${CMAKE_SOURCE_DIR}/tools/gen-theme-header.mjs"
          "${THEME_CSS}" "${GENERATED_DIR}/theme_kirin.gen.h"
  DEPENDS "${THEME_CSS}" "${CMAKE_SOURCE_DIR}/tools/gen-theme-header.mjs"
  VERBATIM)

add_library(va_core STATIC
  src/domain/project_tabs.cpp
  src/domain/file_rules.cpp
  src/domain/terminal_rules.cpp
  src/data/settings_store.cpp
  src/data/project_files.cpp
  src/data/recycle_bin.cpp
  src/data/folder_watch.cpp
  src/data/pty.cpp
  src/data/shell_finder.cpp
  src/data/process_info.cpp
  src/data/terminals.cpp
  src/server/api_server.cpp
  src/server/file_routes.cpp
  src/server/terminal_routes.cpp)
target_include_directories(va_core PUBLIC src)
target_link_libraries(va_core PUBLIC nlohmann_json::nlohmann_json PRIVATE httplib::httplib)

add_executable(Visual-Agent WIN32
  src/app/main.cpp
  src/app/app_window.cpp
  "${GENERATED_DIR}/theme_kirin.gen.h")
target_include_directories(Visual-Agent PRIVATE "${GENERATED_DIR}")
target_link_libraries(Visual-Agent PRIVATE va_core unofficial::webview2::webview2 dwmapi)

# 터미널 테스트에서 에이전트 대신 실행하는 시험용 프로그램. 화면 전체를 쓰고, 받은 키를 파일에 적는다
add_executable(va_fake_agent tests/fake_agent.cpp)

enable_testing()
add_executable(va_tests
  tests/test_main.cpp
  tests/project_tabs_test.cpp
  tests/file_rules_test.cpp
  tests/project_files_test.cpp
  tests/file_routes_test.cpp
  tests/terminal_rules_test.cpp
  tests/terminals_test.cpp
  tests/terminal_routes_test.cpp
  tests/settings_store_test.cpp
  tests/api_server_test.cpp)
target_link_libraries(va_tests PRIVATE va_core doctest::doctest httplib::httplib)
add_dependencies(va_tests va_fake_agent)
target_compile_definitions(va_tests PRIVATE VA_FAKE_AGENT_PATH="$<TARGET_FILE:va_fake_agent>")
add_test(NAME core COMMAND va_tests)
