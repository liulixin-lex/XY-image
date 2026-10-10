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
import type { NodeCanvasHandle } from "../src/components/node-canvas/node-canvas-editor";
import { ToastProvider } from "../src/components/toast";

function renderMenu({
  selected = 0,
  canUndo = false,
}: { selected?: number; canUndo?: boolean } = {}) {
  const canvas = {
    store: {
      getState: () => ({ canUndo, canRedo: false }),
      selectedNodes: () =>
        Array.from({ length: selected }, (_, i) => ({ id: `n${i}` })),
    },
    importImages: vi.fn(),
    fitView: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    duplicateSelection: vi.fn(),
  };
  render(
    <ToastProvider>
      <CanvasLogoMenu
        accessToken="token_123"
        projectId="p1"
        canvasId="c1"
        canvas={canvas as unknown as NodeCanvasHandle}
      />
    </ToastProvider>,
  );
  return canvas;
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

  it("disables duplicate and undo when there is nothing to act on, and fits all content", async () => {
    const canvas = renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "菜单" }));

    expect(
      await screen.findByRole("menuitem", { name: /复制选中内容/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: /撤销/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await userEvent.click(
      screen.getByRole("menuitem", { name: /显示全部内容/ }),
    );
    expect(canvas.fitView).toHaveBeenCalled();
  });

  it("duplicates the selection and undoes through the canvas", async () => {
    const canvas = renderMenu({ selected: 2, canUndo: true });
    await userEvent.click(screen.getByRole("button", { name: "菜单" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /复制选中内容/ }),
    );
    expect(canvas.duplicateSelection).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "菜单" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /撤销/ }),
    );
    expect(canvas.undo).toHaveBeenCalled();
  });

  it("imports images through the canvas's own upload", async () => {
    const canvas = renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "菜单" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "导入图片" }),
    );
    expect(canvas.importImages).toHaveBeenCalled();
  });
});
