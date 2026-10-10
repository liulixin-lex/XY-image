// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchAuthConfig } = vi.hoisted(() => ({
  mockFetchAuthConfig: vi.fn(),
}));

vi.mock("../src/lib/xy2api-api", () => ({
  fetchAuthConfig: mockFetchAuthConfig,
}));

import RegisterPage from "../src/app/register/page";

describe("Register page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("sends visitors to the main-site register page instead of creating local accounts", async () => {
    mockFetchAuthConfig.mockResolvedValue({ registerUrl: "https://main.example.com/register" });

    render(<RegisterPage />);

    // The heading highlights 主站 in an <em>; jsdom reports no `display` for
    // inline elements, so its accessible name gains spaces a browser omits.
    expect(screen.getByRole("heading", { name: /^注册在\s*主站\s*完成$/ })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /去主站注册/ })).toHaveAttribute(
      "href",
      "https://main.example.com/register",
    );
    expect(screen.getByRole("link", { name: "已有账号，去登录" })).toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText(/密码/)).not.toBeInTheDocument();
  });
});
