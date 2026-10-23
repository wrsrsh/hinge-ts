import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HingeMcpContext } from "../client.js";
import { guarded, jsonResult } from "../result.js";
import { loadProfileSummaries, summarizeMessage, type ProfileSummary } from "../summaries.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

type SearchResult = { id: string; title: string; url?: string };
type FetchResult = { id: string; title: string; text: string; url?: string; metadata?: Record<string, unknown> };

/**
 * `search` and `fetch` follow the contract ChatGPT connectors (and deep
 * research) expect: search returns `{ results: [{ id, title, url }] }` and
 * fetch returns one document `{ id, title, text, url, metadata }`, both as JSON
 * text. Ids are namespaced: `match:<userId>`, `like:<userId>`, `rec:<userId>`,
 * `profile:<userId>`, `chat:<channelUrl>`.
 */
export function registerChatGptTools(server: McpServer, context: HingeMcpContext): void {
  const { client } = context;

  server.registerTool(
    "search",
    {
      title: "Search Hinge",
      description: "Searches the user's Hinge matches, received likes, and (when the query mentions recommendations or discover) the recommendation feed by name, location, or prompt text. Returns result ids for fetch. An empty query lists matches.",
      inputSchema: {
        query: z.string().describe("Free text: a name, city, prompt words, or 'recommendations' / 'likes' / 'matches' / 'chats' to pick a source")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ query }) => {
      const results = await search(context, query);
      return jsonResult({ results });
    })
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch Hinge item",
      description: "Fetches the full content for an id returned by search: a profile (match:, like:, rec:, profile:) or a chat transcript (chat:<channelUrl>).",
      inputSchema: {
        id: z.string().min(1).describe("Result id from search")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ id }) => {
      const separator = id.indexOf(":");
      const kind = separator > 0 ? id.slice(0, separator) : "profile";
      const key = separator > 0 ? id.slice(separator + 1) : id;
      if (kind === "chat") {
        return jsonResult(await fetchChat(context, key));
      }
      const lookup = await loadProfileSummaries(client, [key]);
      const profile = lookup.byId.get(key);
      if (!profile) {
        throw new Error(`No profile found for ${id}`);
      }
      return jsonResult(profileDocument(id, profile));
    })
  );
}

async function search(context: HingeMcpContext, rawQuery: string): Promise<SearchResult[]> {
  const { client } = context;
  const query = rawQuery.trim().toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  const wantsRecs = /\b(recommend|recommendations|discover|feed|new people)\b/.test(query);
  const wantsLikes = /\blikes?\b/.test(query);
  const wantsChats = /\b(chats?|messages?|conversations?)\b/.test(query);
  const wantsMatches = /\bmatch(es)?\b/.test(query) || (!wantsRecs && !wantsLikes && !wantsChats);
  const sourceWords = new Set(["recommend", "recommendations", "discover", "feed", "new", "people", "like", "likes", "chat", "chats", "message", "messages", "conversation", "conversations", "match", "matches", "my", "in", "from", "with"]);
  const terms = words.filter((word) => !sourceWords.has(word));

  const candidates: Array<{ id: string; userId: string; label: string }> = [];
  const selfId = client.hingeAuth?.identityId;

  if (wantsMatches) {
    const connections = await client.connections.list().catch(() => ({ connections: [] }));
    for (const connection of connections.connections) {
      candidates.push({ id: `match:${connection.subjectId}`, userId: connection.subjectId, label: "match" });
    }
  }
  if (wantsLikes) {
    const likes = await client.likes.list().catch(() => ({ likes: [] }));
    for (const like of likes.likes ?? []) {
      const userId = like.subjectId ?? like.rating?.subjectId;
      if (userId) candidates.push({ id: `like:${userId}`, userId, label: "liked you" });
    }
  }
  if (wantsRecs) {
    const recs = await client.recommendations.get().catch(() => ({ feeds: [] }));
    for (const feed of recs.feeds) {
      for (const subject of feed.subjects) {
        candidates.push({ id: `rec:${subject.subjectId}`, userId: subject.subjectId, label: `recommendation (${feed.origin})` });
      }
    }
  }

  const results: SearchResult[] = [];
  if (candidates.length) {
    const lookup = await loadProfileSummaries(client, candidates.map((candidate) => candidate.userId));
    for (const candidate of candidates) {
      const profile = lookup.byId.get(candidate.userId);
      const haystack = (profile?.text ?? candidate.userId).toLowerCase();
      if (terms.length && !terms.every((term) => haystack.includes(term))) continue;
      const title = profile ? `${profile.name ?? candidate.userId}${profile.age ? `, ${profile.age}` : ""}${profile.location ? ` (${profile.location})` : ""}` : candidate.userId;
      results.push({ id: candidate.id, title: `${title} - ${candidate.label}` });
    }
  }

  if (wantsChats) {
    await context.ensureChatSession();
    const channels = await client.chat.channels(100).catch(() => ({ channels: [] }));
    for (const channel of channels.channels) {
      const partner = channel.members.find((member) => member.userId !== selfId) ?? channel.members[0];
      const last = channel.lastMessage ? summarizeMessage(channel.lastMessage, selfId) : undefined;
      const haystack = `${partner?.nickname ?? ""} ${last?.["text"] ?? ""}`.toLowerCase();
      if (terms.length && !terms.every((term) => haystack.includes(term))) continue;
      results.push({ id: `chat:${channel.channelUrl}`, title: `Chat with ${partner?.nickname ?? partner?.userId ?? "unknown"}${last ? `: ${String(last["text"]).slice(0, 60)}` : ""}` });
    }
  }
  return results.slice(0, 50);
}

async function fetchChat(context: HingeMcpContext, channelUrl: string): Promise<FetchResult> {
  const { client } = context;
  await context.ensureChatSession();
  const selfId = client.hingeAuth?.identityId;
  const [channel, messages] = await Promise.all([
    client.chat.channel(channelUrl).catch(() => undefined),
    client.chat.fullMessages(channelUrl)
  ]);
  const partner = channel?.members.find((member) => member.userId !== selfId) ?? channel?.members[0];
  const lines = messages.map((message) => {
    const summary = summarizeMessage(message, selfId);
    return `${summary["createdAt"] ?? ""} ${summary["fromSelf"] ? "You" : summary["senderName"] ?? summary["senderUserId"] ?? "Them"}: ${summary["text"]}`;
  });
  return {
    id: `chat:${channelUrl}`,
    title: `Chat with ${partner?.nickname ?? partner?.userId ?? "unknown"}`,
    text: lines.join("\n") || "(no messages yet)",
    metadata: { channelUrl, partnerUserId: partner?.userId ?? null, messageCount: messages.length }
  };
}

function profileDocument(id: string, profile: ProfileSummary): FetchResult {
  return {
    id,
    title: `${profile.name ?? profile.userId}${profile.age ? `, ${profile.age}` : ""}`,
    text: profile.text,
    metadata: {
      userId: profile.userId,
      location: profile.location,
      photos: profile.photos.map((photo) => photo.url),
      prompts: profile.prompts
    }
  };
}
