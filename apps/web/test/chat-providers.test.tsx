// @vitest-environment jsdom
/**
 * The user's own chat providers: the dialog validates before sending and
 * maps server codes back onto the form, and provider codes have copy that
 * never claims a main-site charge.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, updateMock, refreshMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "token-1" } }),
}));

vi.mock("../src/lib/chat-providers-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/chat-providers-api")>()),
  createChatProvider: createMock,
  updateChatProvider: updateMock,
  refreshChatProviderModels: refreshMock,
}));

import { ChatProviderDialog } from "../src/components/settings/chat-provider-dialog";
import type { ChatProvider } from "../src/lib/chat-providers-api";
import { describeIssue } from "../src/lib/generation-errors";
import { ApiApplicationError } from "../src/lib/server-api";

const SECRET = "sk-test-secret-0042";

describe("provider issue copy", () => {
  it.each([
    "provider_auth_failed",
    "provider_model_not_found",
    "provider_rate_limited",
    "provider_tools_unsupported",
    "provider_unavailable",
    "provider_unreachable",
    "provider_blocked_address",
    "provider_models_unavailable",
  ])("%s has its own copy and never claims a main-site charge", (code) => {
    const spec = describeIssue(code, "upstream text must not show");
    expect(spec.title).not.toBe("生成失败");
    expect(spec.message).not.toContain("upstream");
    expect(spec.maybeCharged).toBe(false);
  });
});

describe("ChatProviderDialog", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    createMock.mockReset();
    updateMock.mockReset();
    refreshMock.mockReset();
  });

  const provider: ChatProvider = {
    id: "p-1",
    name: "我的服务商",
    protocol: "openai_compatible",
    baseUrl: "https://api.example.com/v1",
    keyHint: "3f9a",
    models: ["model-a"],
    modelsSource: "fetched",
    enabled: true,
    lastCheckedAt: null,
    lastError: null,
  };

  async function fillCreate(user: ReturnType<typeof userEvent.setup>, baseUrl: string) {
    await user.type(screen.getByLabelText("名称"), "我的服务商");
    await user.type(screen.getByLabelText("接口地址"), baseUrl);
    await user.type(screen.getByLabelText("API Key"), SECRET);
  }

  it("checks the address before sending anything, and keeps the key masked", async () => {
    const user = userEvent.setup();
    render(<ChatProviderDialog target={{ kind: "create" }} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
    await fillCreate(user, "http://api.example.com/v1");
    await user.click(screen.getByRole("button", { name: "添加" }));

    expect(await screen.findByText("只支持 https 地址")).toBeInTheDocument();
    expect(screen.getByLabelText("接口地址")).toHaveAttribute("aria-invalid", "true");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("switches to a manual list when the provider has no model list, then saves it", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    createMock
      .mockRejectedValueOnce(new ApiApplicationError("provider_models_unavailable", "no list", 400))
      .mockResolvedValueOnce({ ...provider, modelsSource: "manual", models: ["glm-4.6"] });
    render(<ChatProviderDialog target={{ kind: "create" }} onClose={() => {}} onSaved={onSaved} />);
    await fillCreate(user, "https://api.example.com/v1/");
    await user.click(screen.getByRole("button", { name: "添加" }));

    expect(await screen.findByText(/没有返回模型列表/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "手动填写" })).toHaveAttribute("aria-checked", "true");

    await user.type(screen.getByRole("textbox", { name: "模型" }), "glm-4.6");
    await user.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createMock).toHaveBeenLastCalledWith("token-1", {
      name: "我的服务商",
      protocol: "openai_compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: SECRET,
      models: ["glm-4.6"],
    });
  });

  it("edits only what changed and needs the key again for a new address", async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValue({ ...provider, baseUrl: "https://other.example.com/v1" });
    render(
      <ChatProviderDialog target={{ kind: "edit", provider }} onClose={() => {}} onSaved={() => {}} />,
    );
    const address = screen.getByLabelText("接口地址");
    await user.clear(address);
    await user.type(address, "https://other.example.com/v1");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("改了接口地址，需要重新填写 API Key")).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("API Key"), SECRET);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("token-1", "p-1", {
        baseUrl: "https://other.example.com/v1",
        apiKey: SECRET,
      }),
    );
  });

  it("says the chat is billed by the provider, not the main-site balance", () => {
    render(<ChatProviderDialog target={{ kind: "create" }} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText(/费用由服务商收取，不从主站余额扣/)).toBeInTheDocument();
  });
});
