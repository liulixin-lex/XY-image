import { describe, expect, it, vi } from "vitest";
import { createAdminSupabaseClient } from "./admin.js";
import { createSupabaseFetch } from "./transport.js";
const env = {
  supabaseUrl: "https://db.example.com",
  supabaseInternalUrl: "http://api-gw:8000",
};
describe("self-hosted Supabase routing", () => {
  it("routes requests internally with original query and credentials", async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await createSupabaseFetch(env, mock)(
      `${env.supabaseUrl}/rest/v1/projects?select=id`,
      { headers: { apikey: "synthetic-service-key" } },
    );
    expect(mock.mock.calls[0]?.[0]).toBe(
      "http://api-gw:8000/rest/v1/projects?select=id",
    );
    expect(mock.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: { apikey: "synthetic-service-key" },
    });
  });
  it("preserves Request upload bodies and header overrides", async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const input = new Request(
      `${env.supabaseUrl}/storage/v1/object/bucket/item`,
      {
        method: "POST",
        body: "synthetic-upload",
        headers: { Authorization: "Bearer old" },
      },
    );
    await createSupabaseFetch(env, mock)(input, {
      headers: { Authorization: "Bearer new" },
    });
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(url).toBe("http://api-gw:8000/storage/v1/object/bucket/item");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer new");
    expect(await new Response(init?.body).text()).toBe("synthetic-upload");
  });
  it("refuses another origin and keeps Storage URLs public", async () => {
    const mock = vi.fn<typeof fetch>();
    await expect(
      createSupabaseFetch(
        env,
        mock,
      )("https://attacker.example.com/rest/v1/users"),
    ).rejects.toThrow("Unexpected Supabase");
    expect(mock).not.toHaveBeenCalled();
    const client = createAdminSupabaseClient({
      ...env,
      supabaseServiceRoleKey: "synthetic-service-key",
    });
    expect(
      client.storage.from("project-assets").getPublicUrl("user/image.png").data
        .publicUrl,
    ).toBe(
      "https://db.example.com/storage/v1/object/public/project-assets/user/image.png",
    );
  });
});
