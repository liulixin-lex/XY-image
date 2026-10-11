// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SkillListItem } from "@loomic/shared";

const searchMarketplace = vi.fn();
vi.mock("../src/lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server-api")>()),
  searchMarketplace: (...args: unknown[]) => searchMarketplace(...args),
}));

import {
  filterCurated,
  installedTabSkills,
} from "../src/components/skills/curated";
import { MarketplacePanel } from "../src/components/skills/marketplace-panel";
import { ToastProvider } from "../src/components/toast";

const at = "2026-10-11T00:00:00.000Z";
function skill(over: Partial<SkillListItem>): SkillListItem {
  return {
    id: over.slug ?? "id",
    name: "技能",
    slug: "slug",
    description: "",
    author: "GGUU AI",
    version: "1.0",
    category: "design",
    iconName: null,
    source: "community",
    isFeatured: false,
    metadata: { market: "curated", tags: [] },
    createdAt: at,
    updatedAt: at,
    installed: false,
    enabled: false,
    ...over,
  };
}

const poster = skill({
  slug: "xy-poster-design",
  name: "海报设计",
  description: "做海报、活动主视觉时使用",
  isFeatured: true,
  metadata: { market: "curated", tags: ["海报", "排版"] },
});
const cover = skill({
  slug: "xy-social-cover",
  name: "社媒封面",
  description: "做平台封面时使用",
  metadata: { market: "curated", tags: ["小红书", "抖音"] },
  installed: true,
  enabled: true,
});
const copy = skill({
  slug: "xy-marketing-copy",
  name: "营销文案",
  category: "writing",
  description: "写标题和口号",
});
const official = skill({
  slug: "json-image-prompt",
  name: "结构化提示词",
  source: "system",
  metadata: {},
  installed: true,
  enabled: true,
});
const own = skill({
  slug: "mine-1a2b3c",
  name: "我的模板",
  source: "user",
  metadata: {},
});
const catalogue = [official, own, poster, cover, copy];

describe("curated skill helpers", () => {
  it("keeps uninstalled curated skills out of 已安装", () => {
    expect(installedTabSkills(catalogue).map((s) => s.slug)).toEqual([
      "json-image-prompt",
      "mine-1a2b3c",
      "xy-social-cover",
    ]);
  });

  it("lists curated skills only, featured first, and searches tags", () => {
    const all = filterCurated(catalogue, { query: "", category: null });
    // Then by pinyin: 社 (she) before 营 (ying).
    expect(all.map((s) => s.slug)).toEqual([
      "xy-poster-design",
      "xy-social-cover",
      "xy-marketing-copy",
    ]);
    expect(
      filterCurated(catalogue, { query: "小红书", category: null }).map(
        (s) => s.slug,
      ),
    ).toEqual(["xy-social-cover"]);
    expect(
      filterCurated(catalogue, { query: "", category: "writing" }).map(
        (s) => s.slug,
      ),
    ).toEqual(["xy-marketing-copy"]);
  });
});

describe("MarketplacePanel", () => {
  afterEach(() => {
    cleanup();
    searchMarketplace.mockReset();
  });

  function renderPanel(skills = catalogue) {
    const onInstallSkill = vi.fn().mockResolvedValue(undefined);
    const onOpenSkill = vi.fn();
    render(
      <ToastProvider>
        <MarketplacePanel
          accessToken={() => "token"}
          onInstalled={vi.fn().mockResolvedValue(undefined)}
          skills={skills}
          loading={false}
          onOpenSkill={onOpenSkill}
          onInstallSkill={onInstallSkill}
        />
      </ToastProvider>,
    );
    return { onInstallSkill, onOpenSkill };
  }

  it("shows the curated skills with their install state, not npm results", async () => {
    const user = userEvent.setup();
    const { onInstallSkill, onOpenSkill } = renderPanel();

    expect(
      screen.getByRole("button", { name: "海报设计" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "结构化提示词" })).toBeNull();
    expect(screen.queryByRole("button", { name: "我的模板" })).toBeNull();
    // Installed: a quiet label instead of a second install.
    expect(
      screen.queryByRole("button", { name: "安装「社媒封面」" }),
    ).toBeNull();
    expect(screen.getByText("已安装")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "安装「海报设计」" }));
    expect(onInstallSkill).toHaveBeenCalledWith("xy-poster-design");
    await user.click(screen.getByRole("button", { name: "营销文案" }));
    expect(onOpenSkill).toHaveBeenCalledWith(copy);
    // Nothing went to the community search on its own.
    expect(searchMarketplace).not.toHaveBeenCalled();
  });

  it("filters by category and by tag", async () => {
    const user = userEvent.setup();
    renderPanel();
    const group = screen.getByRole("group", { name: "按分类筛选" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["全部", "设计", "写作"]);

    await user.click(within(group).getByRole("button", { name: "写作" }));
    expect(screen.queryByRole("button", { name: "海报设计" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "营销文案" }),
    ).toBeInTheDocument();

    await user.click(within(group).getByRole("button", { name: "全部" }));
    await user.type(screen.getByLabelText("搜索精选技能"), "抖音");
    expect(
      screen.getByRole("button", { name: "社媒封面" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "海报设计" })).toBeNull();
  });

  it("keeps the community search folded and labelled unreviewed", async () => {
    const user = userEvent.setup();
    searchMarketplace.mockRejectedValue(new Error("network"));
    renderPanel();
    const toggle = screen.getByRole("button", { name: /社区技能/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("没有经过审核");
    expect(screen.queryByLabelText("搜索社区技能")).toBeNull();

    await user.click(toggle);
    await user.type(screen.getByLabelText("搜索社区技能"), "poster");
    // A failed search says so instead of "no results".
    expect(await screen.findByText("社区市场暂时连不上")).toBeInTheDocument();
  });

  it("says when the server has no curated skills yet", () => {
    renderPanel([official, own]);
    expect(screen.getByText("精选技能还没有上架")).toBeInTheDocument();
  });
});
