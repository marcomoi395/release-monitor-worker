import assert from "node:assert/strict";
import { isNewRelease, parseLatestRelease, parseRepositories } from "./index.ts";

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

console.log("selfcheck ok");
