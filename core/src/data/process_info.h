// 실행 중인 프로그램의 이름(필요하면 명령줄)을 알아낸다.
#pragma once

#include <vector>

#include "domain/terminal_rules.h"

namespace va::data {

// 이미 끝났거나 들여다볼 수 없는 프로그램은 빠진다
std::vector<domain::ProcessInfo> describeProcesses(const std::vector<unsigned long>& processIds);

}  // namespace va::data
