import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type BackendFactory,
  type BackendProtocol,
  CompositeBackend,
  FilesystemBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";

const DEFAULT_SANDBOX_ROOT = "/tmp/loomic-sandbox";
const DEFAULT_SKILLS_ROOT = "/opt/loomic/skills";

/**
 * Create a backend with per-project storage and no host shell access.
 * A temporary directory remains available for trusted screenshot processing.
 *
 * Routes:
 *   /workspace/        → StoreBackend (PostgresStore, per-project)
 *   /memories/         → StoreBackend (PostgresStore, per-project)
 *   /skills/           → FilesystemBackend (shared, read-only system skills)
 *   /workspace-skills/ → StoreBackend (user-installed workspace skills, optional)
 *   default            → StateBackend (ephemeral virtual files)
 */
export function createProductionBackendFactory(
  canvasId: string,
  options?: {
    sandboxRoot?: string;
    skillsRoot?: string;
    hasWorkspaceSkills?: boolean;
  },
): { factory: BackendFactory; sandboxDir: string } {
  const sandboxRoot = resolve(options?.sandboxRoot ?? DEFAULT_SANDBOX_ROOT);
  const skillsRoot = resolve(options?.skillsRoot ?? DEFAULT_SKILLS_ROOT);

  // Per-run isolated directory
  const runId = crypto.randomUUID();
  const sandboxDir = join(sandboxRoot, runId);
  mkdirSync(sandboxDir, { recursive: true });
  const realSandboxDir = realpathSync(sandboxDir);

  // Credentials live in this process. Do not expose a host shell to model tools.
  const skillsBackend = new FilesystemBackend({
    rootDir: skillsRoot,
    virtualMode: true,
  });

  const factory: BackendFactory = (stateAndStore) => {
    const routes: Record<string, BackendProtocol> = {
      "/memories/": new StoreBackend(stateAndStore, {
        namespace: ["projects", canvasId, "memories"],
      }),
      "/workspace/": new StoreBackend(stateAndStore, {
        namespace: ["projects", canvasId, "workspace"],
      }),
      "/skills/": skillsBackend,
    };

    if (options?.hasWorkspaceSkills) {
      routes["/workspace-skills/"] = new StoreBackend(stateAndStore, {
        namespace: ["projects", canvasId, "workspace-skills"],
      });
    }

    return new CompositeBackend(new StateBackend(stateAndStore), routes);
  };

  return { factory, sandboxDir: realSandboxDir };
}
