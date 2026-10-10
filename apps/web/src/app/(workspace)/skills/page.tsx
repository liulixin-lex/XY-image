"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListFilter, Plus, Puzzle, Search, ShieldCheck } from "lucide-react";

import type { SkillCategory, SkillDetail, SkillListItem } from "@loomic/shared";

import { SKILL_CATEGORY_OPTIONS } from "@/components/skills/categories";
import { SkillCard } from "@/components/skills/skill-card";
import { CreateSkillDialog } from "@/components/skills/create-skill-dialog";
import { ImportPanel } from "@/components/skills/import-panel";
import { MarketplacePanel } from "@/components/skills/marketplace-panel";
import { SkillDetailDialog } from "@/components/skills/skill-detail-dialog";
import { PageHeader } from "@/components/page-header";
import { SkillsSkeleton } from "@/components/skeletons/skills-skeleton";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { PosterTabs, posterPanelProps } from "@/components/ui/poster-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";
import {
  ApiAuthError,
  createSkill,
  deleteSkill,
  fetchSkillDetail,
  fetchSkills,
  fetchWorkspaceSkills,
  installSkill,
  toggleSkill,
  uninstallSkill,
} from "@/lib/server-api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type SkillsTab = "installed" | "marketplace" | "import";

const TAB_LABELS: Record<SkillsTab, string> = {
  installed: "已安装",
  marketplace: "市场",
  import: "导入",
};

const TABS: SkillsTab[] = ["installed", "marketplace", "import"];

// ---------------------------------------------------------------------------
// Category filter options
// ---------------------------------------------------------------------------

const CATEGORIES = SKILL_CATEGORY_OPTIONS;

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const emptyVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

// ---------------------------------------------------------------------------
// SkillsPage
// ---------------------------------------------------------------------------

export default function SkillsPage() {
  const { session } = useAuth();
  const { error: toastError } = useToast();

  // Token ref pattern (same as settings page)
  const accessTokenRef = useRef(session?.access_token);
  accessTokenRef.current = session?.access_token;
  const hasInitialized = useRef(false);

  const getToken = useCallback(() => accessTokenRef.current, []);

  // Tab state
  const [activeTab, setActiveTab] = useState<SkillsTab>("installed");

  // Data state
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // Filter state (installed tab only)
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<
    Set<SkillCategory>
  >(new Set());
  const [officialOnly, setOfficialOnly] = useState(false);

  // Dialog state (installed tab only)
  const [createOpen, setCreateOpen] = useState(false);
  const [detailSkill, setDetailSkill] = useState<SkillDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadSkills = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const [catalog, workspace] = await Promise.all([
        fetchSkills(token),
        fetchWorkspaceSkills(token).catch(() => ({ skills: [] as SkillListItem[] })),
      ]);

      // Merge install status from workspace into catalog
      const installedMap = new Map(
        (workspace.skills as SkillListItem[]).map((ws: SkillListItem) => [ws.id, ws]),
      );
      const merged = (catalog.skills as SkillListItem[]).map((skill: SkillListItem) => {
        const ws = installedMap.get(skill.id);
        return ws
          ? { ...skill, installed: true, enabled: ws.enabled ?? true, installedAt: ws.installedAt }
          : { ...skill, installed: false, enabled: false };
      });
      setSkills(merged);
      setLoadFailed(false);
    } catch (err) {
      if (err instanceof ApiAuthError) return;
      console.error("[skills] load failed", err);
      setLoadFailed(true);
    }
  }, [getToken]);

  useEffect(() => {
    if (hasInitialized.current) return;
    if (!session?.access_token) return;
    hasInitialized.current = true;

    (async () => {
      setPageLoading(true);
      await loadSkills();
      setPageLoading(false);
    })();
  }, [session?.access_token, loadSkills]);

  // ---------------------------------------------------------------------------
  // Filtered skills
  // ---------------------------------------------------------------------------

  const filteredSkills = useMemo(() => {
    let result = skills;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      );
    }

    // Category filter
    if (selectedCategories.size > 0) {
      result = result.filter((s) => selectedCategories.has(s.category));
    }

    // Official only filter
    if (officialOnly) {
      result = result.filter((s) => s.source === "system");
    }

    return result;
  }, [skills, searchQuery, selectedCategories, officialOnly]);

  // ---------------------------------------------------------------------------
  // Category toggle
  // ---------------------------------------------------------------------------

  const toggleCategory = useCallback((cat: SkillCategory) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleToggle = useCallback(
    async (skillId: string, enabled: boolean) => {
      const token = getToken();
      if (!token) return;

      // Optimistic update
      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, enabled } : s)),
      );

      try {
        await toggleSkill(token, skillId, enabled);
      } catch (err) {
        console.warn("[skills] toggle failed", err);
        if (!(err instanceof ApiAuthError)) toastError(enabled ? "没有启用成功" : "没有停用成功");
        // Revert on failure
        setSkills((prev) =>
          prev.map((s) =>
            s.id === skillId ? { ...s, enabled: !enabled } : s,
          ),
        );
      }
    },
    [getToken],
  );

  const handleCardClick = useCallback(
    async (skill: SkillListItem) => {
      const token = getToken();
      if (!token) return;

      setDetailLoading(true);
      setDetailOpen(true);

      try {
        const result = await fetchSkillDetail(token, skill.id);
        setDetailSkill(result.skill);
      } catch (err) {
        if (err instanceof ApiAuthError) return;
        // Fallback: display as much as we have
        setDetailSkill({
          ...skill,
          license: null,
          skillContent: "",
          createdBy: null,
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [getToken],
  );

  const handleInstall = useCallback(
    async (skillId: string) => {
      const token = getToken();
      if (!token) return;
      try {
        await installSkill(token, skillId);
        await loadSkills();
      } catch (err) {
        console.error("[skills] install failed", err);
        if (!(err instanceof ApiAuthError)) toastError("技能没有安装成功，请稍后再试");
      }
    },
    [getToken, loadSkills, toastError],
  );

  const handleUninstall = useCallback(
    async (skillId: string) => {
      const token = getToken();
      if (!token) return;
      try {
        await uninstallSkill(token, skillId);
        setDetailOpen(false);
        await loadSkills();
      } catch (err) {
        console.error("[skills] uninstall failed", err);
        if (!(err instanceof ApiAuthError)) toastError("技能没有卸载成功，请稍后再试");
      }
    },
    [getToken, loadSkills, toastError],
  );

  const handleCreate = useCallback(
    async (data: {
      name: string;
      description: string;
      category: SkillCategory;
      skillContent: string;
      files?: Array<{ filePath: string; content: string }>;
    }) => {
      const token = getToken();
      if (!token) return;
      try {
        await createSkill(token, data);
        await loadSkills();
      } catch (err) {
        console.error("[skills] create failed", err);
        if (!(err instanceof ApiAuthError)) toastError("技能没有创建成功，请检查内容后再试");
        throw err;
      }
    },
    [getToken, loadSkills, toastError],
  );

  const handleDelete = useCallback(
    async (skillId: string) => {
      const token = getToken();
      if (!token) return;
      try {
        await deleteSkill(token, skillId);
        setDetailOpen(false);
        await loadSkills();
      } catch (err) {
        console.error("[skills] delete failed", err);
        if (!(err instanceof ApiAuthError)) toastError("技能没有删除，请稍后再试");
      }
    },
    [getToken, loadSkills, toastError],
  );

  // ---------------------------------------------------------------------------
  // Tab-related callbacks for child panels
  // ---------------------------------------------------------------------------

  /** After marketplace install or URL import, reload the installed skills list */
  const handleExternalInstall = useCallback(async () => {
    await loadSkills();
  }, [loadSkills]);

  const switchToInstalled = useCallback(() => {
    setActiveTab("installed");
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedCategories.size > 0 ||
    officialOnly;

  return (
    <div>
      <PageHeader
        title="技能"
        description="给助手装上可复用的做法和工具，对话时会按需调用。"
        className="pb-5"
      />
      <div className="mx-auto max-w-[1600px] px-4 pb-12 sm:px-8 lg:px-12">
      <PosterTabs
        value={activeTab}
        onValueChange={setActiveTab}
        tabs={TABS.map((tab) => ({ value: tab, label: TAB_LABELS[tab] }))}
        ariaLabel="技能分类"
        idPrefix="skills"
      />

      <div {...posterPanelProps("skills", activeTab)} className="pt-6 sm:pt-8">
      {/* === Installed Tab === */}
      {activeTab === "installed" && pageLoading && <SkillsSkeleton />}
      {activeTab === "installed" && !pageLoading && loadFailed && (
        <div className="glass flex flex-col items-start gap-3 rounded-[18px] p-5">
          <p className="text-sm text-fg">技能列表没有加载出来。</p>
          <Button variant="secondary" size="sm" onClick={() => void loadSkills()}>
            重试
          </Button>
        </div>
      )}
      {activeTab === "installed" && !pageLoading && !loadFailed && (
        <>
          {/* Search + Filter Bar -- wraps on small screens */}
          <div className="mb-5 flex flex-wrap items-center gap-2 sm:mb-6 sm:gap-2.5">
            {/* Category filter */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="secondary"
                    className="min-h-[44px] sm:min-h-0"
                  >
                    <ListFilter className="size-3.5" />
                    筛选
                    {selectedCategories.size > 0 && (
                      <span className="numeral ml-0.5 flex size-[18px] items-center justify-center rounded-full bg-acc text-[11px] text-acc-ink">
                        {selectedCategories.size}
                      </span>
                    )}
                  </Button>
                }
              />
              <DropdownMenuContent align="start" sideOffset={6}>
                {CATEGORIES.map((cat) => (
                  <DropdownMenuCheckboxItem
                    key={cat.value}
                    checked={selectedCategories.has(cat.value)}
                    onClick={() => toggleCategory(cat.value)}
                  >
                    {cat.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Search -- full width on mobile, constrained on desktop */}
            <div className="relative order-last w-full sm:order-none sm:max-w-sm sm:flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-muted"
              />
              <input
                type="search"
                placeholder="搜索技能"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="搜索技能"
                className="h-11 w-full rounded-[10px] bg-tint/[0.06] pr-3 pl-8.5 text-sm text-fg caret-acc outline-none transition-shadow placeholder:text-fg-muted focus:shadow-[inset_0_0_0_1px_var(--acc)] sm:h-9"
              />
            </div>

            {/* Official filter toggle */}
            <Button
              variant="secondary"
              aria-pressed={officialOnly}
              className={cn(
                "min-h-[44px] sm:min-h-0",
                officialOnly &&
                  "bg-acc-soft text-acc-text hover:bg-acc-soft hover:text-acc-text",
              )}
              onClick={() => setOfficialOnly((p) => !p)}
            >
              <ShieldCheck className="size-3.5" />
              官方
            </Button>
          </div>

          {/* Add Custom Skill Banner */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="glass mb-5 flex items-center gap-3.5 rounded-[18px] p-3.5 sm:mb-6 sm:gap-5 sm:p-5"
          >
            <div className="hidden size-12 shrink-0 -rotate-6 items-center justify-center rounded-[13px] bg-acc text-acc-ink shadow-acc sm:flex">
              <Puzzle aria-hidden className="size-6" strokeWidth={1.75} />
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[19px] leading-tight text-fg sm:text-[21px]">
                添加自定义技能
              </h3>
              <p className="mt-1 text-[13px] text-fg-soft">
                把常用流程写成 SKILL.md，助手就能照着做
              </p>
            </div>

            <Button variant="accent" slant onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" strokeWidth={2.4} />
              添加
            </Button>
          </motion.div>

          {/* Skills Grid */}
          {filteredSkills.length === 0 ? (
            <motion.div
              variants={emptyVariants}
              initial="hidden"
              animate="visible"
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-[14px] bg-tint/[0.07]">
                <Search aria-hidden className="size-5 text-fg-muted" />
              </div>
              <p className="font-display text-[20px] text-fg">
                {hasActiveFilters ? "没有找到匹配的技能" : "还没有技能"}
              </p>
              <p className="mt-1.5 text-[13px] text-fg-soft">
                {hasActiveFilters
                  ? "换个关键词，或清掉筛选条件"
                  : "创建一个自定义技能，或去「市场」装一个"}
              </p>
            </motion.div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2"
            >
              <AnimatePresence mode="popLayout">
                {filteredSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    onToggle={handleToggle}
                    onClick={handleCardClick}
                    onUninstall={handleUninstall}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </>
      )}

      {/* === Marketplace Tab === */}
      {activeTab === "marketplace" && (
        <MarketplacePanel
          accessToken={getToken}
          onInstalled={handleExternalInstall}
        />
      )}

      {/* === Import Tab === */}
      {activeTab === "import" && (
        <ImportPanel
          accessToken={getToken}
          onImported={handleExternalInstall}
          onSwitchToInstalled={switchToInstalled}
        />
      )}

      {/* Dialogs (installed tab only, but keep mounted for animation) */}
      <CreateSkillDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
      />

      <SkillDetailDialog
        skill={detailSkill}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setDetailSkill(null);
        }}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        onDelete={handleDelete}
      />
      </div>
      </div>
    </div>
  );
}
