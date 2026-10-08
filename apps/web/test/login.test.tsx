// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchViewer,
  mockFetchAuthConfig,
  mockLoginWithPassword,
  mockLoginWithTotp,
  mockVerifyOtp,
  mockGetSession,
  mockOnAuthStateChange,
  mockReplace,
  mockSearchParams,
} = vi.hoisted(() => ({
  mockFetchViewer: vi.fn(),
  mockFetchAuthConfig: vi.fn(),
  mockLoginWithPassword: vi.fn(),
  mockLoginWithTotp: vi.fn(),
  mockVerifyOtp: vi.fn(),
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockReplace: vi.fn(),
  mockSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server-api")>()),
  fetchViewer: mockFetchViewer,
}));

vi.mock("../src/lib/xy2api-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/xy2api-api")>()),
  fetchAuthConfig: mockFetchAuthConfig,
  loginWithPassword: mockLoginWithPassword,
  loginWithTotp: mockLoginWithTotp,
  logoutXy2api: vi.fn(),
}));

vi.mock("../src/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: vi.fn(() => ({
    auth: {
      verifyOtp: mockVerifyOtp,
      onAuthStateChange: mockOnAuthStateChange,
      getSession: mockGetSession,
      signOut: vi.fn(),
    },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: mockReplace })),
  useSearchParams: mockSearchParams,
}));

import { ApiApplicationError } from "../src/lib/server-api";
import LoginPage from "../src/app/login/page";
import { AuthProvider } from "../src/lib/auth-context";

const CONFIG = {
  siteName: "主站",
  turnstileEnabled: false,
  turnstileSiteKey: "",
  captchaUnsupported: false,
  registerUrl: "https://main.example.com/register",
  forgotPasswordUrl: "https://main.example.com/forgot-password",
  egressIp: "",
};

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

async function fillCredentials() {
  fireEvent.change(await screen.findByLabelText("主站邮箱"), {
    target: { value: "user@example.com" },
  });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "s3cret-pass" } });
}

describe("Login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockSearchParams.mockReturnValue(new URLSearchParams());
    mockFetchAuthConfig.mockResolvedValue(CONFIG);
    mockVerifyOtp.mockResolvedValue({
      data: { session: { access_token: "supabase-token" } },
      error: null,
    });
    mockFetchViewer.mockResolvedValue({ workspace: { id: "w1" } });
  });

  afterEach(() => {
    cleanup();
  });

  it("asks for main-site credentials and links to main-site register", async () => {
    renderLogin();

    expect(await screen.findByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByLabelText("主站邮箱")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /去主站注册/ })).toHaveAttribute(
      "href",
      CONFIG.registerUrl,
    );
  });

  it("signs in without 2FA: verifies the token hash, bootstraps, then navigates", async () => {
    mockLoginWithPassword.mockResolvedValue({ status: "ok", tokenHash: "hash_1" });
    renderLogin();
    await fillCredentials();

    fireEvent.click(await screen.findByRole("button", { name: "登录" }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/home"));
    expect(mockLoginWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "s3cret-pass",
    });
    expect(mockVerifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "hash_1" });
    expect(mockFetchViewer).toHaveBeenCalledWith("supabase-token");
  });

  it("runs the TOTP step with the in-memory challenge and keeps secrets out of storage", async () => {
    mockLoginWithPassword.mockResolvedValue({
      status: "2fa_required",
      challenge: "challenge_abc",
      maskedEmail: "u***@example.com",
    });
    mockLoginWithTotp.mockResolvedValue({ status: "ok", tokenHash: "hash_2" });
    renderLogin();
    await fillCredentials();

    fireEvent.click(await screen.findByRole("button", { name: "登录" }));

    expect(await screen.findByRole("heading", { name: "二次验证" })).toBeInTheDocument();
    expect(screen.getByText(/u\*\*\*@example\.com/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("动态验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "验证并登录" }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/home"));
    expect(mockLoginWithTotp).toHaveBeenCalledWith({ challenge: "challenge_abc", code: "123456" });

    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain("s3cret-pass");
    expect(stored).not.toContain("challenge_abc");
    expect(stored).not.toContain("hash_2");
  });

  it("shows readable copy for wrong credentials and does not navigate", async () => {
    mockLoginWithPassword.mockRejectedValue(
      new ApiApplicationError("invalid_credentials", "bad", 401),
    );
    renderLogin();
    await fillCredentials();

    fireEvent.click(await screen.findByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("邮箱或密码不正确。");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("counts down after rate limiting using Retry-After", async () => {
    mockLoginWithPassword.mockRejectedValue(
      new ApiApplicationError("rate_limited", "slow down", 429, 30),
    );
    renderLogin();
    await fillCredentials();

    fireEvent.click(await screen.findByRole("button", { name: "登录" }));

    expect(await screen.findByRole("button", { name: /请等待 30 秒/ })).toBeDisabled();
  });

  it("blocks password login when the main site requires an unsupported captcha", async () => {
    mockFetchAuthConfig.mockResolvedValue({ ...CONFIG, captchaUnsupported: true });
    renderLogin();

    expect(await screen.findByText(/暂时无法用账密登录/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeDisabled();
  });

  it("explains an expired session from the query string", async () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("reason=expired"));
    renderLogin();

    expect(await screen.findByRole("alert")).toHaveTextContent("登录已过期，请重新登录。");
  });
});
