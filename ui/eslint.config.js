// 화면 코드의 규칙. 오류 메시지에는 막는 이유와 대신 쓸 방법을 함께 적는다.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const noEffect = {
  selector: "CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/]",
  message:
    "useEffect로 데이터를 맞추면 실행 순서 결함과 무한 루프가 생깁니다. 상태는 features의 스토어에 두고 useSyncExternalStore로 읽으세요.",
};
const noFetch = {
  selector: "CallExpression[callee.name='fetch']",
  message:
    "코어 요청이 흩어지면 오류 처리가 제각각이 됩니다. src/data/apiClient.ts에 함수를 추가해 그것을 쓰세요.",
};
const noApiPath = {
  selector: "Literal[value=/^\\/api\\//], TemplateElement[value.raw=/^\\/api\\//]",
  message:
    "코어 주소를 여러 곳에 적으면 주소가 바뀔 때 여러 군데가 깨집니다. 주소는 src/data/apiClient.ts의 paths에만 적으세요.",
};
const noTimers = [
  {
    name: "setTimeout",
    message:
      "타이머로 실행 순서를 맞추면 환경마다 동작이 달라집니다. 상태가 바뀔 때 반응하도록 스토어 구독으로 바꾸세요.",
  },
  {
    name: "setInterval",
    message:
      "타이머로 상태를 맞추면 환경마다 동작이 달라집니다. 코어가 알려줄 때 갱신하도록 스토어 구독으로 바꾸세요.",
  },
];

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-globals": ["error", ...noTimers],
      "no-restricted-syntax": ["error", noEffect, noFetch, noApiPath],
      "no-warning-comments": [
        "error",
        { terms: ["임시", "우회", "hack", "workaround"], location: "anywhere" },
      ],
    },
  },
  {
    // 코어와 통신하는 유일한 곳
    files: ["src/data/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", noEffect] },
  },
  {
    // 화면 조각은 표시와 입력만 맡는다
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/data/**", "**/features/**"],
              message:
                "ui는 표시와 입력만 맡습니다. 데이터는 features가 props로 넘겨주게 하세요.",
            },
          ],
        },
      ],
    },
  },
  {
    // 규칙(domain)은 화면·통신·프레임워크를 모른다
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "domain은 React를 모릅니다. 순수 함수와 타입만 두세요." },
          ],
          patterns: [
            {
              group: ["**/ui/**", "**/data/**", "**/features/**", "**/app/**"],
              message:
                "domain은 다른 계층을 참조하지 않습니다. 필요한 값은 함수 인자로 받으세요.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    // 앱 창 테스트는 Node에서 돌지만, 앱 화면 안에서 실행할 코드도 함께 적는다
    files: ["e2e/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
