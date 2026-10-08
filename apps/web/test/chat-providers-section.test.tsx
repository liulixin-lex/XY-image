// @vitest-environment jsdom
/**
 * Settings › 模型 › 对话模型服务商: an older server without the endpoints
 * gets a plain note instead of an error, turning off the provider behind
 * the default chat model says what to do next, and deleting it refreshes
 * both the model list and the account default.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, updateMock, deleteMock, refreshChatModels, refreshAccount } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  refreshChatModels: vi.fn(),
  refreshAccount: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "token-1" } }),
}));

vi.mock("../src/lib/account-context", () => ({
  useAccount: () => ({ refreshChatModels, refreshAccount }),
}));

vi.mock("../src/lib/chat-providers-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/chat-providers-api")>()),
  fetchChatProviders: fetchMock,
  updateChatProvider: updateMock,
  deleteChatProvider: deleteMock,
}));

import { ChatProvidersSection } from "../src/components/settings/chat-providers-section";
import { ToastProvider } from "../src/components/toast";
import type { ChatProvider } from "../src/lib/chat-providers-api";
import { ApiApplicationError } from "../src/lib/server-api";

// jsdom has no PointerEvent; Base UI's Switch creates one when clicked.
if (typeof globalThis.PointerEvent === "undefined") {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {} as typeof globalThis.PointerEvent;
}

const provider: ChatProvider = {
  id: "p-1",
  name: "团队网关",
  protocol: "openai_compatible",
  baseUrl: "https://gateway.example.com/v1",
  keyHint: "3f9a",
  models: ["model-a"],
  modelsSource: "fetched",
  enabled: true,
  lastCheckedAt: "2026-10-08T12:00:00Z",
  lastError: null,
};

function renderSection(defaultProviderId: string | null = "p-1") {
  render(
    <ToastProvider>
      <ChatProvidersSection defaultProviderId={defaultProviderId} />
    </ToastProvider>,
  );
}

describe("ChatProvidersSection", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    refreshChatModels.mockReset();
    refreshAccount.mockReset();
  });

  it("explains, without an error or an add button, when the server has no provider endpoints", async () => {
    fetchMock.mockRejectedValue(new ApiApplicationError("application_error", "Not Found", 404));
    renderSection(null);
    expect(await screen.findByText(/服务器暂时还不支持接入自己的服务商/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /添加服务商/ })).not.toBeInTheDocument();
  });

  it("asks for a new default after turning off the provider the default model belongs to", async () => {
    fetchMock.mockResolvedValue([provider]);
    updateMock.mockResolvedValue({ ...provider, enabled: false });
    const user = userEvent.setup();
    renderSection("p-1");

    await user.click(await screen.findByRole("switch", { name: "启用「团队网关」" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("token-1", "p-1", { enabled: false }));
    expect(await screen.findByText(/记得在上面换一个默认模型/)).toBeInTheDocument();
    expect(refreshChatModels).toHaveBeenCalled();
    expect(screen.getByText("已停用")).toBeInTheDocument();
  });

  it("deletes after confirmation and re-reads the account default it pointed to", async () => {
    fetchMock.mockResolvedValue([provider]);
    deleteMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection("p-1");

    await user.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/删除后默认会改回主站/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("token-1", "p-1"));
    expect(refreshChatModels).toHaveBeenCalled();
    expect(refreshAccount).toHaveBeenCalledWith({ force: true });
    await waitFor(() => expect(screen.queryByText("团队网关")).not.toBeInTheDocument());
  });
});
