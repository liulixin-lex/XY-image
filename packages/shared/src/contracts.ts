import { z } from "zod";

import { toolArtifactSchema } from "./artifacts.js";
import { brandKitAssetTypeSchema } from "./brand-kit-contracts.js";
import { chatEffortSchema } from "./chat-options.js";

export const identifierSchema = z.string().min(1);
export const timestampSchema = z.string().datetime({ offset: true });

export const sessionIdSchema = identifierSchema;
export const conversationIdSchema = identifierSchema;
export const runIdSchema = identifierSchema;
export const messageIdSchema = identifierSchema;
export const toolCallIdSchema = identifierSchema;
export const userIdSchema = identifierSchema;
export const workspaceIdSchema = identifierSchema;
export const projectIdSchema = identifierSchema;
export const canvasIdSchema = identifierSchema;

export const workspaceTypeSchema = z.enum(["personal", "team"]);
export const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);

export const runStatusSchema = z.enum([
  "accepted",
  "running",
  "completed",
  "failed",
  "canceled",
]);

export const imageAttachmentSchema = z.object({
  assetId: z.string().min(1),
  url: z.string().url(),
  mimeType: z.string().min(1),
  name: z.string().min(1).optional(),
});

export const imageModelMentionSchema = z.object({
  mentionType: z.literal("image-model"),
  id: z.string().min(1),
  label: z.string().min(1),
});

export const brandKitAssetMentionSchema = z.object({
  mentionType: z.literal("brand-kit-asset"),
  id: z.string().min(1),
  label: z.string().min(1),
  assetType: brandKitAssetTypeSchema,
  textContent: z.string().nullable().optional(),
  fileUrl: z.string().url().nullable().optional(),
});

export const skillMentionSchema = z.object({
  mentionType: z.literal("skill"),
  id: z.string().min(1),
  label: z.string().min(1),
  slug: z.string().min(1),
});

/**
 * 第 70 条 指定: things the user picks for this message from the chat
 * panel's 「+」 menu (or @): a node on the canvas to work on, a whole brand
 * kit, a tool to use. The server turns them into explicit instructions
 * (agent/runtime.ts buildMentionXmlBlocks).
 */
export const canvasNodeMentionSchema = z.object({
  mentionType: z.literal("canvas-node"),
  id: z.string().min(1),
  label: z.string().min(1),
  /** prompt, generator, image, text, frame or a shape type. */
  nodeType: z.string().min(1).max(40),
});

export const brandKitMentionSchema = z.object({
  mentionType: z.literal("brand-kit"),
  id: z.string().min(1),
  label: z.string().min(1),
});

export const AGENT_PICK_TOOLS = [
  { id: "generate_image", label: "生图", hint: "直接生成图片" },
  {
    id: "canvas_workflow",
    label: "搭建工作流",
    hint: "在画布上搭提示词卡片、生成节点和连线",
  },
  { id: "run_workflow", label: "运行工作流", hint: "运行画布上的生成节点" },
  { id: "web_search", label: "联网搜索", hint: "先查资料再回答" },
  { id: "review", label: "审图", hint: "先看图，再给意见或修改" },
  { id: "edit_canvas", label: "编辑画布", hint: "移动、排版、改文字和形状" },
] as const;
export type AgentPickTool = (typeof AGENT_PICK_TOOLS)[number]["id"];
export const agentPickToolSchema = z.enum(
  AGENT_PICK_TOOLS.map((t) => t.id) as [AgentPickTool, ...AgentPickTool[]],
);

export const toolMentionSchema = z.object({
  mentionType: z.literal("tool"),
  id: agentPickToolSchema,
  label: z.string().min(1),
});

export const messageMentionSchema = z.discriminatedUnion("mentionType", [
  imageModelMentionSchema,
  brandKitAssetMentionSchema,
  skillMentionSchema,
  canvasNodeMentionSchema,
  brandKitMentionSchema,
  toolMentionSchema,
]);

export const imageGenerationPreferenceSchema = z.object({
  mode: z.enum(["auto", "manual"]),
  models: z.array(z.string().min(1)),
});

export const videoGenerationPreferenceSchema = z.object({
  mode: z.enum(["auto", "manual"]),
  models: z.array(z.string().min(1)),
});

export const runCreateRequestSchema = z.object({
  sessionId: sessionIdSchema,
  conversationId: conversationIdSchema,
  prompt: z.string(),
  canvasId: canvasIdSchema.optional(),
  attachments: z.array(imageAttachmentSchema).optional(),
  imageGenerationPreference: imageGenerationPreferenceSchema.optional(),
  videoGenerationPreference: videoGenerationPreferenceSchema.optional(),
  mentions: z.array(messageMentionSchema).optional(),
  accessToken: z.string().optional(),
  model: z.string().optional(),
  /** 第 67 条: 思考强度; missing or "auto" sends none (chat-options.ts). */
  effort: chatEffortSchema.optional(),
  /** 第 67 条: built-in web search; ignored for models without it. */
  webSearch: z.boolean().optional(),
});

export const runCreateResponseSchema = z.object({
  runId: runIdSchema,
  sessionId: sessionIdSchema,
  conversationId: conversationIdSchema,
  status: z.literal("accepted"),
});

export const viewerProfileSchema = z.object({
  id: userIdSchema,
  email: z.string().email(),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().nullable().optional(),
});

export const workspaceSummarySchema = z.object({
  id: workspaceIdSchema,
  name: z.string().min(1),
  type: workspaceTypeSchema,
  ownerUserId: userIdSchema,
});

export const workspaceMembershipSchema = z.object({
  workspaceId: workspaceIdSchema,
  userId: userIdSchema,
  role: workspaceRoleSchema,
});

export const canvasSummarySchema = z.object({
  id: canvasIdSchema,
  name: z.string().min(1),
  isPrimary: z.boolean(),
});

export const projectSummarySchema = z.object({
  id: projectIdSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  thumbnailUrl: z.string().nullable().optional(),
  workspace: workspaceSummarySchema,
  primaryCanvas: canvasSummarySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const canvasContentSchema = z.object({
  elements: z.array(z.record(z.unknown())).default([]),
  appState: z.record(z.unknown()).default({}),
  files: z.record(z.record(z.unknown())).default({}),
});

export const canvasDetailSchema = z.object({
  id: canvasIdSchema,
  name: z.string().min(1),
  projectId: projectIdSchema,
  content: canvasContentSchema,
});

export const profileUpdateRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});

export const workspaceSettingsSchema = z.object({
  defaultModel: z.string().min(1),
});

export const modelInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
});

export const chatSessionIdSchema = identifierSchema;

export const chatToolActivitySchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  status: z.enum(["running", "completed"]),
  input: z.record(z.unknown()).optional(),
  output: z.record(z.unknown()).optional(),
  outputSummary: z.string().optional(),
  artifacts: z.array(toolArtifactSchema).optional(),
});

export const chatSessionSummarySchema = z.object({
  id: chatSessionIdSchema,
  title: z.string(),
  updatedAt: timestampSchema,
});

export const textBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const thinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
});

export const toolBlockSchema = z.object({
  type: z.literal("tool"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  status: z.enum(["running", "completed"]),
  input: z.record(z.unknown()).optional(),
  output: z.record(z.unknown()).optional(),
  outputSummary: z.string().optional(),
  artifacts: z.array(toolArtifactSchema).optional(),
});

export const imageBlockSchema = z.object({
  type: z.literal("image"),
  assetId: z.string().min(1),
  url: z.string().url(),
  mimeType: z.string().min(1),
  source: z.enum(["upload", "canvas-ref"]),
  name: z.string().min(1).optional(),
});

export const imageModelMentionBlockSchema = z.object({
  type: z.literal("mention"),
  mentionType: z.literal("image-model"),
  id: z.string().min(1),
  label: z.string().min(1),
});

export const brandKitAssetMentionBlockSchema = z.object({
  type: z.literal("mention"),
  mentionType: z.literal("brand-kit-asset"),
  id: z.string().min(1),
  label: z.string().min(1),
  assetType: brandKitAssetTypeSchema,
  textContent: z.string().nullable().optional(),
  fileUrl: z.string().url().nullable().optional(),
});

export const skillMentionBlockSchema = z.object({
  type: z.literal("mention"),
  mentionType: z.literal("skill"),
  id: z.string().min(1),
  label: z.string().min(1),
  slug: z.string().min(1),
});

export const canvasNodeMentionBlockSchema = canvasNodeMentionSchema.extend({
  type: z.literal("mention"),
});
export const brandKitMentionBlockSchema = brandKitMentionSchema.extend({
  type: z.literal("mention"),
});
export const toolMentionBlockSchema = toolMentionSchema.extend({
  type: z.literal("mention"),
});

export const mentionBlockSchema = z.union([
  imageModelMentionBlockSchema,
  brandKitAssetMentionBlockSchema,
  skillMentionBlockSchema,
  canvasNodeMentionBlockSchema,
  brandKitMentionBlockSchema,
  toolMentionBlockSchema,
]);

export const contentBlockSchema = z.union([
  textBlockSchema,
  thinkingBlockSchema,
  toolBlockSchema,
  imageBlockSchema,
  mentionBlockSchema,
]);

export const chatMessageSchema = z.object({
  id: identifierSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  toolActivities: z.array(chatToolActivitySchema).nullable().optional(),
  contentBlocks: z.array(contentBlockSchema).nullable().optional(),
  createdAt: timestampSchema,
});

export const chatMessageCreateRequestSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  toolActivities: z.array(chatToolActivitySchema).nullable().optional(),
  contentBlocks: z.array(contentBlockSchema).nullable().optional(),
});

export const assetBucketSchema = z.enum(["project-assets", "user-avatars"]);

export const assetObjectSchema = z.object({
  id: identifierSchema,
  bucket: assetBucketSchema,
  objectPath: z.string().min(1),
  mimeType: z.string().min(1).nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.nullable(),
  createdAt: timestampSchema,
});

export type AssetBucket = z.infer<typeof assetBucketSchema>;
export type AssetObject = z.infer<typeof assetObjectSchema>;

export type TextBlock = z.infer<typeof textBlockSchema>;
export type ThinkingBlock = z.infer<typeof thinkingBlockSchema>;
export type ToolBlock = z.infer<typeof toolBlockSchema>;
export type ImageBlock = z.infer<typeof imageBlockSchema>;
export type MessageMention = z.infer<typeof messageMentionSchema>;
export type MentionBlock = z.infer<typeof mentionBlockSchema>;
export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;
export type ImageGenerationPreference = z.infer<
  typeof imageGenerationPreferenceSchema
>;
export type VideoGenerationPreference = z.infer<
  typeof videoGenerationPreferenceSchema
>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type ChatSessionSummary = z.infer<typeof chatSessionSummarySchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatMessageCreateRequest = z.infer<typeof chatMessageCreateRequestSchema>;
export type ChatToolActivity = z.infer<typeof chatToolActivitySchema>;
export type ProfileUpdateRequest = z.infer<typeof profileUpdateRequestSchema>;
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export type ModelInfo = z.infer<typeof modelInfoSchema>;
export type RunCreateRequest = z.infer<typeof runCreateRequestSchema>;
export type RunCreateResponse = z.infer<typeof runCreateResponseSchema>;
export type ViewerProfile = z.infer<typeof viewerProfileSchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type WorkspaceMembership = z.infer<typeof workspaceMembershipSchema>;
export type CanvasSummary = z.infer<typeof canvasSummarySchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type CanvasContent = z.infer<typeof canvasContentSchema>;
export type CanvasDetail = z.infer<typeof canvasDetailSchema>;
