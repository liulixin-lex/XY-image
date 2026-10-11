import type { FastifyInstance, FastifyReply } from "fastify";

import {
  applicationErrorResponseSchema,
  marketplaceInstallRequestSchema,
  skillDetailResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@loomic/shared";

import {
  searchMarketplace,
  getMarketplaceDetail,
  installFromMarketplace,
  MarketplaceError,
} from "../features/skills/marketplace-service.js";
import { SkillImportError } from "../features/skills/skill-import-service.js";
import { SKILL_IMPORT_MESSAGES, skillSlug } from "../features/skills/slug.js";

import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type {
  RequestAuthenticator,
  UserSupabaseClient,
} from "../supabase/user.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedFrom = (client: UserSupabaseClient, table: string) => (client as any).from(table);

// ---------------------------------------------------------------------------
// Skill row mappers (duplicated from skills.ts to avoid circular imports)
// ---------------------------------------------------------------------------

type SkillRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  author: string;
  version: string;
  license: string | null;
  category: string;
  icon_name: string | null;
  source: string;
  skill_content: string;
  metadata: Record<string, unknown> | null;
  is_featured: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  source_url: string | null;
  package_name: string | null;
};

type SkillFileRow = {
  id: string;
  skill_id: string;
  file_path: string;
  content: string;
  mime_type: string;
  created_at: string;
  updated_at: string;
};

function mapSkillRow(row: SkillRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    author: row.author,
    version: row.version,
    category: row.category,
    iconName: row.icon_name,
    source: row.source,
    isFeatured: row.is_featured,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSkillDetailRow(row: SkillRow) {
  return {
    ...mapSkillRow(row),
    license: row.license,
    skillContent: row.skill_content,
    createdBy: row.created_by,
    sourceUrl: row.source_url ?? null,
    packageName: row.package_name ?? null,
  };
}

function mapSkillFileRow(row: SkillFileRow) {
  return {
    id: row.id,
    filePath: row.file_path,
    content: row.content,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerMarketplaceRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    createUserClient: (accessToken: string) => UserSupabaseClient;
    viewerService: ViewerService;
  },
) {
  // The 市场 tab's curated skills come from GET /api/skills (source =
  // 'community', migration 20261011000003). These routes are its secondary
  // "社区搜索": npm packages tagged agent-skill, unreviewed, installed as the
  // user's own copy.

  // GET /api/skills/marketplace/search — search skills.sh via npm registry
  app.get("/api/skills/marketplace/search", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { q = "", page = "1", limit = "20" } = request.query as Record<string, string>;
      const result = await searchMarketplace(q, parseInt(page, 10), parseInt(limit, 10));
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof MarketplaceError) {
        request.log.warn({ err: error }, "marketplace search failed");
        return sendError(reply, "marketplace_search_failed", "社区市场暂时连不上，请稍后再试", 502);
      }
      request.log.error({ err: error }, "marketplace search error");
      return sendError(reply, "marketplace_search_failed", "社区市场暂时连不上，请稍后再试");
    }
  });

  // GET /api/skills/marketplace/detail — get package detail from npm registry
  app.get("/api/skills/marketplace/detail", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { name } = request.query as { name?: string };
      if (!name) {
        return reply.code(400).send(
          applicationErrorResponseSchema.parse({
            error: { code: "marketplace_detail_failed", message: "缺少包名" },
          }),
        );
      }
      const detail = await getMarketplaceDetail(name);
      return reply.code(200).send(detail);
    } catch (error) {
      if (error instanceof MarketplaceError) {
        const notFound = error.code === "package_not_found";
        request.log.warn({ err: error }, "marketplace detail failed");
        return sendError(
          reply,
          "marketplace_detail_failed",
          notFound ? "社区里没有这个包了" : "社区市场暂时连不上，请稍后再试",
          notFound ? 404 : 502,
        );
      }
      request.log.error({ err: error }, "marketplace detail error");
      return sendError(reply, "marketplace_detail_failed", "社区市场暂时连不上，请稍后再试");
    }
  });

  // POST /api/skills/marketplace/install — install a skill from skills.sh
  app.post("/api/skills/marketplace/install", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { packageName } = marketplaceInstallRequestSchema.parse(request.body);
      const viewer = await options.viewerService.ensureViewer(user);
      const workspaceId = viewer.workspace.id;
      const client = options.createUserClient(user.accessToken);

      // Slugs no longer collide on the name, so look for the package itself:
      // a second click used to install a second copy.
      const { data: existing } = await untypedFrom(client, "skills")
        .select("id")
        .eq("created_by", user.id)
        .eq("metadata->>package_name", packageName)
        .limit(1);
      if (existing?.length) {
        return sendError(reply, "marketplace_install_failed", "这个技能已经装过了，在「已安装」里可以找到", 409);
      }

      // Download and parse from npm registry
      const { imported, packageName: pkgName } = await installFromMarketplace(packageName);
      const slug = skillSlug(imported.manifest.name);

      // Insert skill
      const { data: skillData, error: skillError } = await untypedFrom(client, "skills")
        .insert({
          name: imported.manifest.name,
          slug,
          description: imported.manifest.description,
          author: imported.manifest.author ?? "unknown",
          version: imported.manifest.version ?? "1.0",
          license: imported.manifest.license ?? null,
          category: "custom",
          source: "user",
          skill_content: imported.skillContent,
          metadata: {
            ...(imported.manifest.metadata ?? {}),
            source_url: `https://www.npmjs.com/package/${packageName}`,
            package_name: pkgName,
          },
          created_by: user.id,
        })
        .select("*")
        .single();

      if (skillError) {
        request.log.error({ err: skillError }, "marketplace install DB insert failed");
        if (skillError.code === "23505") {
          return sendError(reply, "marketplace_install_failed", "技能标识冲突了，请再装一次", 409);
        }
        return sendError(reply, "marketplace_install_failed", "技能没有保存成功，请稍后再试");
      }

      // Insert files
      if (imported.files.length > 0 && skillData?.id) {
        const fileRows = imported.files.map((f) => ({
          skill_id: skillData.id,
          file_path: f.filePath,
          content: f.content,
          mime_type: f.mimeType,
        }));
        const { error: fileError } = await untypedFrom(client, "skill_files").insert(fileRows);
        if (fileError) {
          request.log.error({ err: fileError }, "marketplace install file insert failed (non-fatal)");
        }
      }

      // Auto-install to workspace
      if (skillData?.id) {
        await untypedFrom(client, "workspace_skills").upsert(
          { workspace_id: workspaceId, skill_id: skillData.id, enabled: true, installed_by: user.id },
          { onConflict: "workspace_id,skill_id" },
        );
      }

      // Return full skill detail with files
      const { data: fileData } = await untypedFrom(client, "skill_files")
        .select("*")
        .eq("skill_id", skillData.id)
        .order("file_path", { ascending: true });

      const skill = {
        ...mapSkillDetailRow(skillData),
        files: (fileData ?? []).map(mapSkillFileRow),
      };

      return reply.code(201).send(skillDetailResponseSchema.parse({ skill }));
    } catch (error) {
      // The English detail stays in the log.
      if (error instanceof SkillImportError) {
        request.log.warn({ code: error.code, message: error.message }, "marketplace install rejected");
        return sendError(reply, "marketplace_install_failed", SKILL_IMPORT_MESSAGES[error.code], 400);
      }
      if (error instanceof MarketplaceError) {
        request.log.warn({ err: error }, "marketplace install failed");
        return sendError(
          reply,
          "marketplace_install_failed",
          error.code === "install_failed"
            ? "这个包里没有可用的 SKILL.md，装不上"
            : error.code === "package_not_found"
              ? "社区里没有这个包了"
              : "社区市场暂时连不上，请稍后再试",
          502,
        );
      }
      request.log.error({ err: error }, "marketplace install error");
      return sendError(reply, "marketplace_install_failed", "安装失败，请稍后再试");
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendUnauthenticated(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: { code: "unauthorized", message: "Missing or invalid bearer token." },
    }),
  );
}

function sendError(
  reply: FastifyReply,
  code: string,
  message: string,
  statusCode = 500,
) {
  return reply.code(statusCode).send(
    applicationErrorResponseSchema.parse({
      error: { code, message },
    }),
  );
}
