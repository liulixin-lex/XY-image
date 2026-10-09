import { describe, expect, it } from "vitest";
import { runFailureText } from "./errors.js";

describe("runFailureText", () => {
  it("says what the main site refused", () => {
    expect(
      runFailureText({
        message: "内容未通过审核，请修改提示词",
        details: { gatewayCode: "safety_filter" },
      }),
    ).toBe("没能完成：内容未通过审核，请修改提示词");
  });

  it("stays generic for other failures", () => {
    expect(runFailureText({ message: "请求处理失败，请稍后再试" })).toBe(
      "抱歉，处理过程中遇到问题，请重试。",
    );
  });
});
