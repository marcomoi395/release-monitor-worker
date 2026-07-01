import assert from "node:assert/strict";
import { formatDiscordNotification, isNewRelease, parseLatestRelease, parseRepositories } from "./index.ts";
import { fetch as workerFetch } from "./index.ts";

const repos = parseRepositories('["https://github.com/cloudflare/workers-sdk", "https://github.com/cloudflare/workers-sdk/"]');
assert.deepEqual(repos, [
  { owner: "cloudflare", repo: "workers-sdk", url: "https://github.com/cloudflare/workers-sdk" },
]);

const sampleAtom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/12345678/v1.2.3</id>
    <updated>2026-07-01T00:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/cloudflare/workers-sdk/releases/tag/v1.2.3" />
    <title>v1.2.3</title>
    <content type="html">&lt;p&gt;Fixes&lt;br/&gt;&lt;/p&gt;&lt;p&gt;More&lt;/p&gt;</content>
  </entry>
</feed>`;

const latest = parseLatestRelease(sampleAtom);
if (!latest) {
  throw new Error("parseLatestRelease returned null");
}

assert.deepEqual(latest, {
  id: "tag:github.com,2008:Repository/12345678/v1.2.3",
  publishedAt: "2026-07-01T00:00:00Z",
  title: "v1.2.3",
  url: "https://github.com/cloudflare/workers-sdk/releases/tag/v1.2.3",
  content: "Fixes\n\nMore",
});

assert.equal(isNewRelease(null, latest), false);
assert.equal(isNewRelease({ id: "old", publishedAt: "2026-01-01T00:00:00Z" }, latest), true);
assert.equal(isNewRelease({ id: latest.id, publishedAt: "2026-01-01T00:00:00Z" }, latest), false);
const formatted = formatDiscordNotification(
  repos[0],
  latest,
  "- Sửa lỗi quan trọng\n- Cải thiện hiệu năng"
);
assert.equal(
  formatted,
  [
    "## cloudflare/workers-sdk",
    "Phiên bản: [**v1.2.3**](https://github.com/cloudflare/workers-sdk/releases/tag/v1.2.3)",
    "",
    "**Tóm tắt**",
    "- Sửa lỗi quan trọng\n- Cải thiện hiệu năng",
  ].join("\n")
);

const truncated = formatDiscordNotification(repos[0], latest, "A".repeat(4000));
assert.equal(truncated.length <= 2000, true);
assert.equal(
  truncated.startsWith(
    "## cloudflare/workers-sdk\nPhiên bản: [**v1.2.3**](https://github.com/cloudflare/workers-sdk/releases/tag/v1.2.3)\n\n**Tóm tắt**\n"
  ),
  true
);

const runResponse = await workerFetch(
  new Request("https://example.com/run"),
  {
    KV: {} as KVNamespace,
    REPOSITORIES: "[]",
    OPENAI_MODEL: "gpt-5.4-nano",
    OPENAI_API_KEY: "test-key",
    DISCORD_WEBHOOK_URL: "https://discord.invalid/webhook",
  },
  {} as ExecutionContext,
);

assert.equal(runResponse.status, 200);
assert.equal(await runResponse.text(), "monitor run complete");

console.log("selfcheck ok");
