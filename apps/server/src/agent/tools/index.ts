import type { StructuredTool } from "@langchain/core/tools";
import type { BackendFactory, BackendProtocol } from "deepagents";
import type { AvailableModel } from "../../generation/providers/registry.js";
import type { UserSupabaseClient } from "../../supabase/user.js";

import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ReviewImageStore } from "../vision.js";
import { createApplyPatchTool } from "./apply-patch.js";
import { createBrandKitTool } from "./brand-kit.js";
import {
  type SubmitWorkflowBatchFn,
  type WaitForJobsFn,
  createCanvasWorkflowTool,
  createRunWorkflowTool,
} from "./canvas-workflow.js";
import {
  type PersistImageFn,
  type SubmitImageJobFn,
  createImageGenerateTool,
} from "./image-generate.js";
import { createInspectCanvasTool } from "./inspect-canvas.js";
import { createManipulateCanvasTool } from "./manipulate-canvas.js";
import { createPersistSandboxFileTool } from "./persist-sandbox-file.js";
import { createProjectSearchTool } from "./project-search.js";
import { createScreenshotCanvasTool } from "./screenshot-canvas.js";
import { createVideoGenerateTool } from "./video-generate.js";
import { createViewImagesTool } from "./view-images.js";
import { pictureRef } from "./view-images.js";

export { createImageGenerateTool } from "./image-generate.js";
export { createVideoGenerateTool } from "./video-generate.js";
export { createInspectCanvasTool } from "./inspect-canvas.js";
export { createManipulateCanvasTool } from "./manipulate-canvas.js";

// ---------------------------------------------------------------------------
// deepagents 内置工具参考 (由 FilesystemMiddleware 自动注入)
// ---------------------------------------------------------------------------
//
// deepagents@1.8.4 通过 createFilesystemMiddleware 自动注入以下工具，
// 我们自定义的工具名称不能与这些冲突：
//
//   ls          — 列出目录内容
//   read_file   — 读取文件内容（支持 offset/limit）
//   write_file  — 写入文件
//   edit_file   — 编辑文件（find & replace）
//   glob        — 按模式匹配文件路径
//   grep        — 按正则搜索文件内容
//   execute     — 执行 shell 命令（仅 SandboxBackendProtocol 时可用）
//   task        — 分发子任务到 subagent
//   write_todos — 管理 TODO 列表
//
// 生产环境的 default backend 是 StateBackend（backends/prod.ts），没有
// shell，execute 工具不会出现；LocalShellBackend 只在 backends/dev.ts 里用，
// 且 createAgentBackend 拒绝 filesystem 模式。
//
// CompositeBackend 路由互不干扰：
//   /workspace/  → StoreBackend (PostgresStore) — 文件持久化
//   /memories/   → StoreBackend (PostgresStore) — agent 记忆
//   /skills/     → FilesystemBackend            — 系统 skills
//   default      → StateBackend                 — 临时文件（无 shell）
// ---------------------------------------------------------------------------

export function createMainAgentTools(
  backend: BackendProtocol | BackendFactory,
  deps: {
    createUserClient: (accessToken: string) => UserSupabaseClient;
    brandKitId?: string | null;
    connectionManager?: ConnectionManager;
    persistImage?: PersistImageFn;
    sandboxDir?: string;
    submitImageJob?: SubmitImageJobFn;
    availableModels?: AvailableModel[];
    /** 第 67 条 审图: pictures the model is shown (agent/vision.ts). */
    reviewImages?: ReviewImageStore;
    /** 第 69 条: running 生成 nodes from the chat (agent/runtime.ts). */
    workflow?: {
      submitBatch: SubmitWorkflowBatchFn;
      waitForJobs: WaitForJobsFn;
      notifyCanvas?: () => void;
    };
  },
) {
  const tools: StructuredTool[] = [
    createProjectSearchTool(backend),
    // 第 67 条: multi-place, multi-file edits in one call (Codex format).
    createApplyPatchTool(backend) as unknown as StructuredTool,
    createInspectCanvasTool(deps),
    createManipulateCanvasTool(deps),
    // 第 69 条: node canvas workflows (prompt cards → 生成 nodes → pictures).
    createCanvasWorkflowTool({
      createUserClient: deps.createUserClient,
      availableModels: deps.availableModels ?? [],
    }) as unknown as StructuredTool,
    createImageGenerateTool({
      availableModels: deps.availableModels ?? [],
      ...(deps.submitImageJob ? { submitImageJob: deps.submitImageJob } : {}),
    }),

    createPersistSandboxFileTool({
      createUserClient: deps.createUserClient,
      ...(deps.sandboxDir ? { sandboxDir: deps.sandboxDir } : {}),
    }),
    // execute 工具由 deepagents FilesystemMiddleware 自动注入，
    // 因为 CompositeBackend 的 default backend 是 LocalShellBackend。
    // 不需要在这里手动注册。
  ];
  if (deps.workflow) {
    tools.push(
      createRunWorkflowTool({
        createUserClient: deps.createUserClient,
        submitBatch: deps.workflow.submitBatch,
        waitForJobs: deps.workflow.waitForJobs,
        ...(deps.workflow.notifyCanvas
          ? { notifyCanvas: deps.workflow.notifyCanvas }
          : {}),
        pictureUrl: canvasPictureUrl,
      }) as unknown as StructuredTool,
    );
  }
  if (deps.brandKitId) {
    tools.push(createBrandKitTool(deps, deps.brandKitId));
  }
  if (deps.connectionManager) {
    tools.push(
      createScreenshotCanvasTool({
        connectionManager: deps.connectionManager,
        ...(deps.persistImage ? { persistImage: deps.persistImage } : {}),
        ...(deps.reviewImages ? { reviewImages: deps.reviewImages } : {}),
      }),
    );
  }
  if (deps.reviewImages) {
    tools.push(
      createViewImagesTool({
        createUserClient: deps.createUserClient,
        reviewImages: deps.reviewImages,
      }),
    );
  }
  return tools;
}

/** @deprecated Use createMainAgentTools + sub-agents instead */
export function createPhaseATools(backend: BackendProtocol | BackendFactory) {
  return [createProjectSearchTool(backend), createImageGenerateTool()] as const;
}

/**
 * The URL a canvas picture is sent by as a reference: its stored object's
 * public Storage URL (the form the worker accepts, xy2api-reference.ts), as
 * the page sends it; an https picture as it is.
 */
export function canvasPictureUrl(
  client: {
    storage: {
      from: (bucket: string) => {
        getPublicUrl: (path: string) => { data: { publicUrl: string } };
      };
    };
  },
  element: Record<string, unknown>,
  files: Record<string, Record<string, unknown>> | undefined,
): string | null {
  const ref = pictureRef(element, files);
  if (!ref) return null;
  if (!ref.startsWith("oss://")) return ref;
  const rest = ref.slice("oss://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return client.storage
    .from(rest.slice(0, slash))
    .getPublicUrl(rest.slice(slash + 1)).data.publicUrl;
}
