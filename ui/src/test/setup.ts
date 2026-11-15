import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom에는 화면 스크롤 기능이 없다
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => cleanup());
