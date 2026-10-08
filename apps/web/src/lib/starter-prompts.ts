/**
 * Starter briefs on the home page. Text only on purpose: the old example
 * library mirrored third-party showcase images (see home-example-seeds.ts),
 * which this site has no rights to display.
 *
 * TODO(xy): replace with an operator-curated list (DB-backed) once there
 * are licensed sample outputs to show next to each brief.
 */
export type StarterPrompt = {
  label: string;
  prompt: string;
};

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    label: "开业海报",
    prompt:
      "给一家社区精品咖啡店做开业海报，竖版 3:4。给出三个方向：极简排版、复古胶片、手绘插画。店名「晨间烘焙」，开业日期 10 月 18 日。",
  },
  {
    label: "电商主图",
    prompt:
      "为一款白色陶瓷保温杯做电商主图：纯色背景、柔和顶光、45 度角特写，再做一张生活场景图（木桌、清晨窗光）。",
  },
  {
    label: "品牌标志",
    prompt:
      "为独立书店「慢读」探索三套标志方向：字标、图形标、组合标，并展示在门头和帆布袋上的效果。",
  },
  {
    label: "社媒九宫格",
    prompt:
      "为一个徒步户外品牌做小红书九宫格，主题「秋天的第一条山路」，统一色调，留出放标题文字的位置。",
  },
  {
    label: "绘本插画",
    prompt:
      "画一组儿童绘本插画：一只小狐狸在雪夜里给森林邻居送灯笼，水彩质感，温暖的橙色灯光，共三幕。",
  },
  {
    label: "包装设计",
    prompt:
      "为一款桂花乌龙冷泡茶设计瓶身包装，清爽、东方、留白多，展示正面、侧面和货架陈列效果。",
  },
];
