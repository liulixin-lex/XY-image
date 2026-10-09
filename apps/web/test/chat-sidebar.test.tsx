// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamEvent, WsCommandAck } from "@loomic/shared";
import type { WebSocketHandle } from "../src/hooks/use-websocket";
import { ChatSidebar } from "../src/components/chat-sidebar";
import { ToastProvider } from "../src/components/toast";

const {
  createSessionMock,
  deleteSessionMock,
  fetchMessagesMock,
  fetchSessionsMock,
  saveMessageMock,
  updateSessionTitleMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  fetchMessagesMock: vi.fn(),
  fetchSessionsMock: vi.fn(),
  saveMessageMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  createSession: createSessionMock,
  deleteSession: deleteSessionMock,
  fetchMessages: fetchMessagesMock,
  fetchSessions: fetchSessionsMock,
  fetchWorkspaceSkills: vi.fn(async () => ({ skills: [] })),
  saveMessage: saveMessageMock,
  updateSessionTitle: updateSessionTitleMock,
}));

const { reportCodeMock, notifyGenerationSettledMock } = vi.hoisted(() => ({
  reportCodeMock: vi.fn(),
  notifyGenerationSettledMock: vi.fn(),
}));

vi.mock("../src/components/issues/issue-provider", () => ({
  useIssues: () => ({ report: vi.fn(), reportCode: reportCodeMock }),
}));

vi.mock("../src/lib/account-context", () => ({
  useAccount: () => ({
    account: { data: null, loading: false, error: null },
    notifyGenerationSettled: notifyGenerationSettledMock,
    refreshImageModels: vi.fn(),
    refreshChatModels: vi.fn(),
    imageModels: { data: [], loading: false, error: null },
  }),
  useImageModels: () => ({ data: [], loading: false, error: null, refresh: vi.fn() }),
  useChatModels: () => ({ data: [], loading: false, error: null, xy2apiError: null, refresh: vi.fn() }),
}));

function createMockWs(): WebSocketHandle {
  return {
    connected: true,
    startRun: vi.fn((payload, onAck) => {
      // Simulate server ack
      onAck?.({
        type: "command.ack",
        action: "agent.run",
        payload: { runId: "run_123" },
      });
      return true;
    }),
    cancelRun: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    registerRPC: vi.fn(() => () => {}),
    resumeCanvas: vi.fn(),
  };
}

describe("ChatSidebar", () => {
  let mockWs: WebSocketHandle;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    mockWs = createMockWs();
    createSessionMock.mockReset();
    createSessionMock.mockResolvedValue({
      session: {
        id: "session-created",
        title: "New Chat",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    });
    deleteSessionMock.mockReset();
    fetchMessagesMock.mockReset();
    fetchMessagesMock.mockResolvedValue({ messages: [] });
    fetchSessionsMock.mockReset();
    fetchSessionsMock.mockResolvedValue({
      sessions: [
        {
          id: "session-real",
          title: "Existing Chat",
          updatedAt: "2026-03-24T00:00:00.000Z",
        },
      ],
    });
    saveMessageMock.mockReset();
    saveMessageMock.mockResolvedValue(undefined);
    updateSessionTitleMock.mockReset();
    updateSessionTitleMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("starts runs via WebSocket with the active real session id", async () => {
    render(
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          canvasId="canvas-1"
          open
          onToggle={() => {}}
          ws={mockWs}
        />
      </ToastProvider>,
    );

    const input = await screen.findByPlaceholderText(/说说你想做什么/);
    await userEvent.type(input, "hello loom{Enter}");

    await waitFor(() =>
      expect(mockWs.startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-real",
          conversationId: "canvas-1",
          prompt: "hello loom",
          canvasId: "canvas-1",
        }),
        expect.any(Function),
      ),
    );
    expect(mockWs.startRun).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-canvas-1",
      }),
      expect.anything(),
    );
  });

  function renderWithEvents(ackLater = false) {
    const listeners: Array<(event: StreamEvent) => void> = [];
    let ack: (() => void) | undefined;
    mockWs = {
      ...createMockWs(),
      onEvent: vi.fn((listener: (event: StreamEvent) => void) => {
        listeners.push(listener);
        return () => {};
      }),
      startRun: vi.fn((_payload, onAck) => {
        ack = () =>
          onAck?.({
            type: "command.ack",
            action: "agent.run",
            payload: { runId: "run_123" },
          });
        if (!ackLater) ack();
        return true;
      }),
    } as WebSocketHandle;
    render(
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          canvasId="canvas-1"
          open
          onToggle={() => {}}
          ws={mockWs}
        />
      </ToastProvider>,
    );
    const emit = (event: Record<string, unknown>) =>
      act(() => {
        for (const listener of listeners)
          listener({
            runId: "run_123",
            timestamp: "2026-10-09T00:00:00Z",
            ...event,
          } as StreamEvent);
      });
    return { emit, ack: () => act(() => ack?.()) };
  }

  it("stops a streaming run and frees the input when the run ends", async () => {
    const { emit } = renderWithEvents();
    const input = await screen.findByPlaceholderText(/说说你想做什么/);
    await userEvent.type(input, "画一座灯塔{Enter}");

    const stop = await screen.findByRole("button", { name: "停止" });
    expect(screen.queryByRole("button", { name: "发送" })).not.toBeInTheDocument();
    await userEvent.click(stop);
    expect(mockWs.cancelRun).toHaveBeenCalledWith("run_123");
    expect(screen.getByRole("button", { name: "正在停止" })).toBeDisabled();

    await emit({ type: "run.canceled" });
    expect(await screen.findByRole("button", { name: "发送" })).toBeInTheDocument();
    expect(screen.getByText("已停止。")).toBeInTheDocument();
  });

  it("sends a stop asked for before the run was acknowledged once its id arrives", async () => {
    const { ack } = renderWithEvents(true);
    const input = await screen.findByPlaceholderText(/说说你想做什么/);
    await userEvent.type(input, "你好{Enter}");

    await userEvent.click(await screen.findByRole("button", { name: "停止" }));
    expect(mockWs.cancelRun).not.toHaveBeenCalled();
    await ack();
    expect(mockWs.cancelRun).toHaveBeenCalledWith("run_123");
  });

  function renderSidebar(ws: WebSocketHandle) {
    render(
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          canvasId="canvas-1"
          open
          onToggle={() => {}}
          ws={ws}
        />
      </ToastProvider>,
    );
  }

  it("does not send before the connection is up, and keeps the text", async () => {
    mockWs = { ...createMockWs(), connected: false };
    renderSidebar(mockWs);
    const input = await screen.findByPlaceholderText(/说说你想做什么/);
    await userEvent.type(input, "你好{Enter}");

    expect(mockWs.startRun).not.toHaveBeenCalled();
    expect(saveMessageMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(input).toHaveValue("你好");
  });

  it("takes a message back when the run could not go out", async () => {
    mockWs = { ...createMockWs(), startRun: vi.fn(() => false) };
    renderSidebar(mockWs);
    const input = await screen.findByPlaceholderText(/说说你想做什么/);
    await userEvent.type(input, "画一座灯塔{Enter}");

    expect(
      await screen.findByText("还没连上服务器，这条消息没有发出。连上后再发一次。"),
    ).toBeInTheDocument();
    expect(input).toHaveValue("画一座灯塔");
    expect(screen.queryByText("画一座灯塔", { selector: "p, span, div" })).not.toBeInTheDocument();
    expect(saveMessageMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument();
  });

  it("saves the user message once the run went out", async () => {
    renderSidebar(mockWs);
    const input = await screen.findByPlaceholderText(/说说你想做什么/);
    await userEvent.type(input, "你好{Enter}");
    await waitFor(() =>
      expect(saveMessageMock).toHaveBeenCalledWith(
        "token_abc",
        "session-real",
        expect.objectContaining({ role: "user", content: "你好" }),
      ),
    );
    expect(updateSessionTitleMock).toHaveBeenCalledWith("token_abc", "session-real", "你好");
  });

  // The page sent a run, the connection dropped, and it came back.
  function renderReconnecting() {
    const listeners: Array<(event: StreamEvent) => void> = [];
    let resumeAck: ((ack: WsCommandAck) => void) | undefined;
    const base: WebSocketHandle = {
      ...createMockWs(),
      onEvent: vi.fn((listener: (event: StreamEvent) => void) => {
        listeners.push(listener);
        return () => {
          listeners.splice(listeners.indexOf(listener), 1);
        };
      }),
      resumeCanvas: vi.fn((_canvasId: string, onAck?: (ack: WsCommandAck) => void) => {
        resumeAck = onAck;
      }),
    };
    const onStreamEvent = vi.fn();
    const ui = (ws: WebSocketHandle) => (
      <ToastProvider>
        <ChatSidebar
          accessToken="token_abc"
          canvasId="canvas-1"
          open
          onToggle={() => {}}
          onStreamEvent={onStreamEvent}
          ws={ws}
        />
      </ToastProvider>
    );
    const view = render(ui(base));
    return {
      onStreamEvent,
      emit: (event: Record<string, unknown>) =>
        act(() => {
          for (const listener of [...listeners])
            listener({
              runId: "run_123",
              timestamp: "2026-10-09T00:00:00Z",
              ...event,
            } as StreamEvent);
        }),
      reconnect: async (activeRunId: string | null) => {
        resumeAck = undefined;
        view.rerender(ui({ ...base, connected: false }));
        view.rerender(ui({ ...base, connected: true }));
        await waitFor(() => expect(resumeAck).toBeDefined());
        act(() =>
          resumeAck?.({
            type: "command.ack",
            action: "canvas.resume",
            payload: { canvasId: "canvas-1", activeRunId, replayed: 0 },
          }),
        );
      },
    };
  }

  it("ends a run the server lost while the page was disconnected", async () => {
    const { reconnect, onStreamEvent } = renderReconnecting();
    const input = await screen.findByPlaceholderText(/说说你想做什么/);
    await userEvent.type(input, "画一座灯塔{Enter}");
    await screen.findByRole("button", { name: "停止" });

    await reconnect(null);
    expect(
      await screen.findByText(
        "连接断开期间这条回复没有完成，不会自动重发。需要的话可以再发一次。",
        undefined,
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument();
    // The page looks for image jobs the run had already sent.
    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run.failed", runId: "run_123" }),
    );
  }, 10_000);

  it("lets the replayed events end a run that finished while disconnected", async () => {
    const { reconnect, emit } = renderReconnecting();
    const input = await screen.findByPlaceholderText(/说说你想做什么/);
    await userEvent.type(input, "你好{Enter}");
    await screen.findByRole("button", { name: "停止" });

    await reconnect(null);
    await emit({ type: "message.delta", messageId: "m-1", delta: "你好！" });
    await emit({ type: "run.completed" });
    expect(await screen.findByRole("button", { name: "发送" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    expect(
      screen.queryByText(/连接断开期间这条回复没有完成/),
    ).not.toBeInTheDocument();
  }, 10_000);

  it("says why the main site refused a message and reports it", async () => {
    const { emit } = renderWithEvents();
    const input = await screen.findByPlaceholderText(/说说你想做什么/);
    await userEvent.type(input, "你好{Enter}");
    await screen.findByRole("button", { name: "停止" });

    await emit({
      type: "run.failed",
      error: {
        code: "run_failed",
        message: "内容未通过审核，请修改提示词",
        details: { gatewayCode: "safety_filter" },
      },
    });
    expect(
      await screen.findByText("没能完成：内容未通过审核，请修改提示词"),
    ).toBeInTheDocument();
    expect(reportCodeMock).toHaveBeenCalledWith(
      "safety_filter",
      "内容未通过审核，请修改提示词",
    );
  });
});
