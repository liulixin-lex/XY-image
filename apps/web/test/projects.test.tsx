// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, replace: mockReplace })),
}));

const mockAuthValue = {
  user: { id: "u1" },
  session: { access_token: "token_123", user: { id: "u1" } },
  loading: false,
  signOut: vi.fn(),
};
vi.mock("../src/lib/auth-context", () => ({
  useAuth: vi.fn(() => mockAuthValue),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import ProjectsPage from "../src/app/(workspace)/projects/page";
import { ToastProvider } from "../src/components/toast";
import { AUTH_EXPIRED_EVENT } from "../src/lib/server-api";

const workspace = { id: "w1", name: "My Workspace", type: "personal", ownerUserId: "u1" };

const projectsResponse = {
  projects: [
    {
      id: "p1", name: "品牌海报", slug: "brand",
      description: null, workspace, thumbnailUrl: null,
      primaryCanvas: { id: "c1", name: "Main Canvas", isPrimary: true },
      createdAt: "2026-03-23T00:00:00Z", updatedAt: "2026-03-23T10:00:00Z",
    },
    {
      id: "p2", name: "包装设计", slug: "pack",
      description: null, workspace, thumbnailUrl: null,
      primaryCanvas: { id: "c2", name: "Main Canvas", isPrimary: true },
      createdAt: "2026-03-22T00:00:00Z", updatedAt: "2026-03-22T00:00:00Z",
    },
  ],
};

function respond(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function mockProjects(body: unknown = projectsResponse) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/api/projects") && init?.method === "POST") {
      return respond(201, {
        project: { ...projectsResponse.projects[0], id: "p9", primaryCanvas: { id: "c9" } },
      });
    }
    if (url.includes("/api/projects/") && init?.method === "DELETE") return respond(204, {});
    if (url.endsWith("/api/projects")) return respond(200, body);
    return respond(404, {});
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <ProjectsPage />
    </ToastProvider>,
  );
}

describe("Projects page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:3001");
  });

  afterEach(() => {
    cleanup();
  });

  it("lists canvas projects with their count", async () => {
    mockProjects();
    renderPage();

    expect(await screen.findByText("品牌海报")).toBeInTheDocument();
    expect(screen.getByText("包装设计")).toBeInTheDocument();
    expect(screen.getByText("2 个")).toBeInTheDocument();
    expect(screen.getByText("品牌海报").closest("a")).toHaveAttribute("href", "/canvas?id=c1");
  });

  it("explains the empty state", async () => {
    mockProjects({ projects: [] });
    renderPage();

    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument();
  });

  it("shows a retry when loading fails and does not sign out", async () => {
    mockFetch.mockImplementation(() => respond(500, { error: { code: "boom", message: "x" } }));
    renderPage();

    expect(await screen.findByText("项目列表没有加载出来。")).toBeInTheDocument();
    mockProjects();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("品牌海报")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("leaves a 401 to the global session-expiry handler", async () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, listener);
    mockFetch.mockImplementation(() =>
      respond(401, { error: { code: "unauthorized", message: "Bad token" } }),
    );
    renderPage();

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("项目列表没有加载出来。")).not.toBeInTheDocument();
    window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
  });

  it("creates a blank canvas and opens it in the same tab", async () => {
    mockProjects();
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /新建画布/ }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/canvas?id=c9"));
    const post = mockFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1].body as string)).toEqual({ name: "未命名项目" });
  });

  it("deletes a project after confirmation", async () => {
    mockProjects();
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "删除项目 品牌海报" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(screen.queryByText("品牌海报")).not.toBeInTheDocument());
    expect(
      mockFetch.mock.calls.some(
        ([url, init]) => String(url).endsWith("/api/projects/p1") && init?.method === "DELETE",
      ),
    ).toBe(true);
  });
});
