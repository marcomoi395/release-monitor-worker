type RepositoryConfig = { owner: string; repo: string; url: string };
type ReleaseEntry = {
  id: string;
  publishedAt: string;
  title: string;
  url: string;
  content: string;
};
type StoredReleaseState = { id: string; publishedAt: string };

interface Env {
  KV: KVNamespace;
  REPOSITORIES: string;
  OPENAI_MODEL: string;
  OPENAI_API_KEY: string;
  DISCORD_WEBHOOK_URL: string;
}

const GITHUB_FEED_HEADERS = {
  "User-Agent": "release-monitor-worker",
  Accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.1",
} as const;

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DISCORD_LIMIT = 2000;

export function formatDiscordNotification(
  repo: RepositoryConfig,
  release: ReleaseEntry,
  summary: string,
): string {
  const normalizedSummary = summary
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  const header = [
    `## ${repo.owner}/${repo.repo}`,
    `Phiên bản: [**${release.title}**](${release.url})`,
    "",
    "**Tóm tắt**",
  ].join("\n");
  const summaryLimit = DISCORD_LIMIT - header.length - 1;
  const fittedSummary =
    normalizedSummary.length <= summaryLimit
      ? normalizedSummary
      : `${normalizedSummary.slice(0, Math.max(0, summaryLimit - 1)).trimEnd()}…`;

  return `${header}\n${fittedSummary}`;
}

export function parseRepositories(raw: string): RepositoryConfig[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "REPOSITORIES must be a JSON array of GitHub repository URLs",
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "REPOSITORIES must be a JSON array of GitHub repository URLs",
    );
  }

  const seen = new Set<string>();
  const repos: RepositoryConfig[] = [];

  for (const item of parsed) {
    if (typeof item !== "string") {
      throw new Error(
        "REPOSITORIES must be a JSON array of GitHub repository URLs",
      );
    }

    let url: URL;

    try {
      url = new URL(item);
    } catch {
      throw new Error(
        "REPOSITORIES must be a JSON array of GitHub repository URLs",
      );
    }

    if (url.hostname !== "github.com") {
      throw new Error(
        "REPOSITORIES must be a JSON array of GitHub repository URLs",
      );
    }

    const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (segments.length !== 2 || !segments[0] || !segments[1]) {
      throw new Error(
        "REPOSITORIES must be a JSON array of GitHub repository URLs",
      );
    }

    const owner = segments[0];
    const repo = segments[1];
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    repos.push({ owner, repo, url: `https://github.com/${owner}/${repo}` });
  }

  return repos;
}

export function parseLatestRelease(xml: string): ReleaseEntry | null {
  const entry = xml.match(/<entry\b[\s\S]*?<\/entry>/i)?.[0];
  if (!entry) {
    return null;
  }

  const id = extractTag(entry, "id");
  const publishedAt = extractTag(entry, "updated");
  const title = extractTag(entry, "title");
  const content = extractTag(entry, "content");
  const link = entry.match(/<link\b[^>]*\brel="alternate"[^>]*>/i)?.[0];
  const url = link ? (link.match(/\bhref="([^"]+)"/i)?.[1] ?? null) : null;

  if (!id || !publishedAt || !title || !content || !url) {
    return null;
  }

  return {
    id: decodeXmlEntities(id),
    publishedAt: decodeXmlEntities(publishedAt),
    title: decodeXmlEntities(title),
    url: decodeXmlEntities(url),
    content: htmlToPlainText(decodeXmlEntities(content)),
  };
}

export function isNewRelease(
  stored: StoredReleaseState | null,
  latest: ReleaseEntry,
): boolean {
  if (!stored) {
    return false;
  }

  if (stored.id === latest.id) {
    return false;
  }

  return Date.parse(latest.publishedAt) > Date.parse(stored.publishedAt);
}

async function runMonitor(env: Env): Promise<void> {
  const repos = parseRepositories(env.REPOSITORIES);

  if (repos.length === 0) {
    console.log("No repositories configured");
    return;
  }

  for (const repo of repos) {
    try {
      await monitorRepository(env, repo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Monitor failed for ${repo.owner}/${repo.repo}: ${message}`,
      );
    }
  }
}

async function monitorRepository(
  env: Env,
  repo: RepositoryConfig,
): Promise<void> {
  const response = await globalThis.fetch(`${repo.url}/releases.atom`, {
    headers: GITHUB_FEED_HEADERS,
  });

  if (!response.ok) {
    throw new Error(
      `GitHub feed fetch failed for ${repo.owner}/${repo.repo}: ${response.status}`,
    );
  }

  const xml = await response.text();
  const latest = parseLatestRelease(xml);

  if (!latest) {
    if (xml.includes("<entry")) {
      console.log(`Malformed feed for ${repo.owner}/${repo.repo}`);
    } else {
      console.log(`No releases found for ${repo.owner}/${repo.repo}`);
    }

    return;
  }

  const key = `release:${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`;
  const rawState = await env.KV.get(key);

  if (rawState === null) {
    await env.KV.put(
      key,
      JSON.stringify({ id: latest.id, publishedAt: latest.publishedAt }),
    );
    return;
  }

  let stored: StoredReleaseState;

  try {
    const parsed: unknown = JSON.parse(rawState);
    if (!isStoredReleaseState(parsed)) {
      throw new Error("invalid");
    }
    stored = parsed;
  } catch {
    console.log(
      `Stored release state is invalid for ${repo.owner}/${repo.repo}; replacing baseline`,
    );
    await env.KV.put(
      key,
      JSON.stringify({ id: latest.id, publishedAt: latest.publishedAt }),
    );
    return;
  }

  if (!isNewRelease(stored, latest)) {
    return;
  }

  const summary = await summarizeRelease(env, repo, latest);
  await sendDiscordNotification(env, repo, latest, summary);
  await env.KV.put(
    key,
    JSON.stringify({ id: latest.id, publishedAt: latest.publishedAt }),
  );
}

async function summarizeRelease(
  env: Env,
  repo: RepositoryConfig,
  release: ReleaseEntry,
): Promise<string> {
  const response = await globalThis.fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "Bạn tóm tắt release note GitHub bằng tiếng Việt, ngắn gọn, dễ hiểu. Tối đa 5 gạch đầu dòng. Nêu thay đổi quan trọng, breaking change nếu có, và bỏ chi tiết nhiễu như danh sách dependency phụ nếu không quan trọng.",
        },
        {
          role: "user",
          content: `Repository: ${repo.owner}/${repo.repo}\nRelease: ${release.title}\nURL: ${release.url}\nNội dung release:\n${release.content.slice(0, 12000)}`,
        },
      ],
      max_output_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI summary failed: ${response.status} ${await responseSnippet(response)}`,
    );
  }

  const data: unknown = await response.json();
  const summary = getOpenAIOutputText(data) || collectResponseText(data);

  if (!summary.trim()) {
    throw new Error("OpenAI response did not include output text");
  }

  return summary.trim();
}

async function sendDiscordNotification(
  env: Env,
  repo: RepositoryConfig,
  release: ReleaseEntry,
  summary: string,
): Promise<void> {
  const content = formatDiscordNotification(repo, release, summary);
  const response = await globalThis.fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Release Monitor",
      allowed_mentions: { parse: [] },
      content,
    }),
  });

  if (!response.ok && response.status !== 204) {
    throw new Error(
      `Discord webhook failed: ${response.status} ${await responseSnippet(response)}`,
    );
  }
}

async function responseSnippet(response: Response): Promise<string> {
  return (await response.text()).slice(0, 500);
}

function extractTag(xml: string, tag: string): string | null {
  return (
    xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\/${tag}>`, "i"))?.[1] ??
    null
  );
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:lt|gt|amp|quot|#39|#x[0-9a-fA-F]+|#[0-9]+);/g,
    (entity) => {
      switch (entity) {
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&amp;":
          return "&";
        case "&quot;":
          return '"';
        case "&#39;":
          return "'";
        default: {
          if (entity.startsWith("&#x")) {
            return String.fromCodePoint(
              Number.parseInt(entity.slice(3, -1), 16),
            );
          }

          return String.fromCodePoint(Number.parseInt(entity.slice(2, -1), 10));
        }
      }
    },
  );
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOpenAIOutputText(data: unknown): string {
  if (!isRecord(data) || typeof data.output_text !== "string") {
    return "";
  }

  return data.output_text.trim();
}

function collectResponseText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.output)) {
    return "";
  }

  const chunks: string[] = [];

  for (const item of data.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function isStoredReleaseState(value: unknown): value is StoredReleaseState {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.publishedAt === "string"
  );
}

export async function scheduled(
  _controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  await runMonitor(env);
}

export async function fetch(
  _request: Request,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  return new Response("release-monitor-worker ready");
}

const worker = { scheduled, fetch } satisfies ExportedHandler<Env>;

export default worker;
