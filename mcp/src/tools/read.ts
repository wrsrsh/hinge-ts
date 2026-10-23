import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RecommendationsResponse } from "hinge-ts";
import { z } from "zod";
import type { HingeMcpContext } from "../client.js";
import { guarded, jsonResult } from "../result.js";
import { loadProfileSummaries, summarizeChannel, summarizeMessage } from "../summaries.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export function registerReadTools(server: McpServer, context: HingeMcpContext): void {
  const { client } = context;

  server.registerTool(
    "hinge_me",
    {
      title: "My Hinge profile",
      description: "Returns the logged-in user's own profile and profile content (photos, prompt answers).",
      inputSchema: {},
      annotations: READ_ONLY
    },
    guarded(async () => {
      const [me, content] = await Promise.all([client.profiles.me(), client.profiles.content().catch(() => undefined)]);
      return jsonResult({ userId: me.userId ?? client.hingeAuth?.identityId ?? null, profile: me.profile ?? null, content: content?.content ?? null });
    })
  );

  server.registerTool(
    "hinge_profiles",
    {
      title: "Look up Hinge profiles",
      description: "Fetches public profiles for one or more Hinge user ids and returns compact summaries (name, age, location, prompts, photos) plus a readable text rendering.",
      inputSchema: {
        userIds: z.array(z.string().min(1)).min(1).max(75).describe("Hinge user ids (subjectId values from recommendations, likes, or matches)"),
        includeRaw: z.boolean().optional().describe("Include the raw profile object for each user")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ userIds, includeRaw }) => {
      const lookup = await loadProfileSummaries(client, userIds, { includeRaw: includeRaw ?? false });
      return jsonResult({ profiles: lookup.ordered, missing: userIds.filter((id) => !lookup.byId.has(id)) });
    })
  );

  server.registerTool(
    "hinge_preferences",
    {
      title: "Dating preferences",
      description: "Returns the user's current dating preferences (age range, distance, dealbreakers, and so on).",
      inputSchema: {},
      annotations: READ_ONLY
    },
    guarded(async () => jsonResult(await client.profiles.preferences()))
  );

  server.registerTool(
    "hinge_recommendations",
    {
      title: "Recommendations feed",
      description: "Fetches the current recommendation feeds (the profiles Hinge shows in Discover). Each subject has subjectId and ratingToken, which hinge_like and hinge_skip need. Profiles are summarized by default.",
      inputSchema: {
        newHere: z.boolean().optional().describe("Filter to people new on Hinge"),
        activeToday: z.boolean().optional().describe("Filter to people active today"),
        includeProfiles: z.boolean().optional().describe("Attach profile summaries (default true)"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum subjects to return (default 25)")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ newHere, activeToday, includeProfiles, limit }) => {
      const recs: RecommendationsResponse = newHere !== undefined || activeToday !== undefined
        ? await client.recommendations.getWithParams({ newHere: newHere ?? false, activeToday: activeToday ?? false })
        : await client.recommendations.get();
      const subjects = recs.feeds.flatMap((feed) => feed.subjects.map((subject) => ({
        subjectId: subject.subjectId,
        ratingToken: subject.ratingToken,
        origin: subject.origin ?? feed.origin,
        feedId: feed.id
      }))).slice(0, limit ?? 25);
      const lookup = includeProfiles === false
        ? undefined
        : await loadProfileSummaries(client, subjects.map((subject) => subject.subjectId));
      return jsonResult({
        feeds: recs.feeds.map((feed) => ({ id: feed.id, origin: feed.origin, subjectCount: feed.subjects.length })),
        subjects: subjects.map((subject) => ({ ...subject, profile: lookup?.byId.get(subject.subjectId) ?? null }))
      });
    })
  );

  server.registerTool(
    "hinge_standouts",
    {
      title: "Standouts",
      description: "Returns the Standouts feed (curated profiles that usually need a rose to like).",
      inputSchema: {},
      annotations: READ_ONLY
    },
    guarded(async () => jsonResult(await client.connections.standouts()))
  );

  server.registerTool(
    "hinge_like_limit",
    {
      title: "Remaining likes",
      description: "Returns how many likes (and roses / superlikes) remain today.",
      inputSchema: {},
      annotations: READ_ONLY
    },
    guarded(async () => jsonResult(await client.likes.limit()))
  );

  server.registerTool(
    "hinge_likes_received",
    {
      title: "Likes received",
      description: "Lists people who liked the user. Each entry has subjectId and ratingToken so hinge_like (to match) or hinge_skip (to pass) can respond. Profiles are summarized by default.",
      inputSchema: {
        includeProfiles: z.boolean().optional().describe("Attach profile summaries (default true)"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum entries (default 25)")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ includeProfiles, limit }) => {
      const response = await client.likes.list();
      const likes = (response.likes ?? []).slice(0, limit ?? 25).map((like) => ({
        subjectId: like.subjectId ?? like.rating?.subjectId ?? null,
        ratingToken: like.rating?.ratingToken ?? null,
        comment: (like.rating?.content as Record<string, unknown> | undefined)?.["comment"] ?? null,
        likedContent: like.rating?.content ?? null
      }));
      const ids = likes.map((like) => like.subjectId).filter((id): id is string => Boolean(id));
      const lookup = includeProfiles === false ? undefined : await loadProfileSummaries(client, ids);
      return jsonResult({
        total: response.likes?.length ?? 0,
        likes: likes.map((like) => ({ ...like, profile: like.subjectId ? lookup?.byId.get(like.subjectId) ?? null : null }))
      });
    })
  );

  server.registerTool(
    "hinge_matches",
    {
      title: "Matches",
      description: "Lists current connections (matches). Returns each match's subjectId, who initiated, and a profile summary.",
      inputSchema: {
        includeProfiles: z.boolean().optional().describe("Attach profile summaries (default true)"),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum matches (default 50)")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ includeProfiles, limit }) => {
      const response = await client.connections.list();
      const selfId = client.hingeAuth?.identityId;
      const connections = response.connections.slice(0, limit ?? 50).map((connection) => ({
        subjectId: connection.subjectId,
        initiatedByMe: connection.initiatorId === selfId,
        ...pick(connection, ["created", "lastActivity", "status", "isNewMatch", "hasUnread"])
      }));
      const lookup = includeProfiles === false ? undefined : await loadProfileSummaries(client, connections.map((c) => c.subjectId));
      return jsonResult({
        total: response.connections.length,
        matches: connections.map((connection) => ({ ...connection, profile: lookup?.byId.get(connection.subjectId) ?? null }))
      });
    })
  );

  server.registerTool(
    "hinge_match_detail",
    {
      title: "Match detail",
      description: "Returns connection details and the match note (if any) for one match, plus the profile summary.",
      inputSchema: {
        subjectId: z.string().min(1).describe("The match's user id")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ subjectId }) => {
      const [detail, matchNote, lookup] = await Promise.all([
        client.connections.detail(subjectId),
        client.connections.matchNote(subjectId).catch(() => null),
        loadProfileSummaries(client, [subjectId])
      ]);
      return jsonResult({ subjectId, detail, matchNote, profile: lookup.byId.get(subjectId) ?? null });
    })
  );

  server.registerTool(
    "hinge_chats",
    {
      title: "Chat channels",
      description: "Lists chat channels (conversations with matches) with the partner, unread count, and last message. Use channelUrl with hinge_chat_messages.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("Maximum channels (default 30)")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ limit }) => {
      await context.ensureChatSession();
      const response = await client.chat.channels(limit ?? 30);
      const selfId = client.hingeAuth?.identityId;
      return jsonResult({ channels: response.channels.map((channel) => summarizeChannel(channel, selfId)) });
    })
  );

  server.registerTool(
    "hinge_chat_messages",
    {
      title: "Chat messages",
      description: "Returns messages from one chat channel, oldest first. Either pass channelUrl from hinge_chats or partnerUserId to resolve the channel for a match.",
      inputSchema: {
        channelUrl: z.string().min(1).optional().describe("Sendbird channel url from hinge_chats"),
        partnerUserId: z.string().min(1).optional().describe("Match user id; used when channelUrl is not known"),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum messages (default 50)"),
        beforeTimestamp: z.number().int().optional().describe("Only messages created before this unix millisecond timestamp")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ channelUrl, partnerUserId, limit, beforeTimestamp }) => {
      await context.ensureChatSession();
      const url = channelUrl ?? (partnerUserId ? (await client.chat.ensureDmWith(partnerUserId)).channelUrl : undefined);
      if (!url) {
        throw new Error("Pass channelUrl or partnerUserId");
      }
      const response = await client.chat.messages({ channelUrl: url, messageTs: String(beforeTimestamp ?? Date.now()), prevLimit: limit ?? 50 });
      const selfId = client.hingeAuth?.identityId;
      const messages = response.messages.map((message) => summarizeMessage(message, selfId)).reverse();
      return jsonResult({ channelUrl: url, count: messages.length, messages });
    })
  );

  server.registerTool(
    "hinge_prompts_search",
    {
      title: "Search Hinge prompts",
      description: "Searches the catalog of Hinge profile prompts by text, or lists prompts in a category. Useful for suggesting prompt answers.",
      inputSchema: {
        query: z.string().optional().describe("Text to search prompt questions for"),
        category: z.string().optional().describe("Category slug to list"),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum prompts (default 30)")
      },
      annotations: READ_ONLY
    },
    guarded(async ({ query, category, limit }) => {
      const manager = await client.prompts.manager();
      let prompts = query ? manager.searchPrompts(query) : category ? manager.getPromptsByCategory(category) : manager.getSelectablePrompts();
      prompts = prompts.slice(0, limit ?? 30);
      return jsonResult({
        prompts: prompts.map((prompt) => ({ id: prompt.id, prompt: prompt.prompt, placeholder: prompt.placeholder, categories: prompt.categories })),
        categories: manager.getVisibleCategories().map((c) => ({ slug: c.slug, name: c.name ?? c.slug }))
      });
    })
  );
}

function pick(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  return out;
}
