// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

vi.mock("../src/hooks/use-create-project", () => ({
  useCreateProject: () => ({ create: vi.fn() }),
}));

const mockDeleteProject = vi.fn();
vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server-api")>()),
  deleteProject: (...args: unknown[]) => mockDeleteProject(...args),
}));

import { CanvasLogoMenu } from "../src/components/canvas-logo-menu";
import { ToastProvider } from "../src/components/toast";

function renderMenu(selected: Record<string, boolean> = {}) {
  const excalidrawApi = {
    getAppState: () => ({ selectedElementIds: selected }),
    setActiveTool: vi.fn(),
    scrollToContent: vi.fn(),
  };
  render(
    <ToastProvider>
      <CanvasLogoMenu
        accessToken="token_123"
        projectId="p1"
        canvasId="c1"
        excalidrawApi={excalidrawApi}
      />
    </ToastProvider>,
  );
  return excalidrawApi;
}

describe("CanvasLogoMenu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("asks for a second click before deleting the project", async () => {
    mockDeleteProject.mockResolvedValue(undefined);
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "菜单" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "删除当前项目" }),
    );

    // The menu stays open and shows the confirm step instead of closing.
    const confirm = await screen.findByRole("menuitem", {
      name: "再点一次，确认删除",
    });
    expect(mockDeleteProject).not.toHaveBeenCalled();

    await userEvent.click(confirm);
    await waitFor(() =>
      expect(mockDeleteProject).toHaveBeenCalledWith("token_123", "p1"),
    );
    expect(mockPush).toHaveBeenCalledWith("/projects");
  });

  it("disables duplicate when nothing is selected and fits all content", async () => {
    const api = renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "菜单" }));

    expect(
      await screen.findByRole("menuitem", { name: /复制选中内容/ }),
    ).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(screen.getByRole("menuitem", { name: /显示全部内容/ }));
    expect(api.scrollToContent).toHaveBeenCalledWith(undefined, {
      fitToContent: true,
      animate: true,
    });
  });

  it("imports images through Excalidraw's own image tool", async () => {
    const api = renderMenu({ e1: true });
    await userEvent.click(screen.getByRole("button", { name: "菜单" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "导入图片" }));
    expect(api.setActiveTool).toHaveBeenCalledWith({
      type: "image",
      insertOnCanvasDirectly: true,
    });
  });
});
