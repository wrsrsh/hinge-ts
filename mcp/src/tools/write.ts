import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HingeHttpMethod, Preferences } from "hinge-ts";
import { z } from "zod";
import type { HingeMcpContext } from "../client.js";
import { guarded, jsonResult } from "../result.js";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

/**
 * Tools that change the account. All are skipped when HINGE_MCP_READ_ONLY is
 * set, so a read-only server never advertises them.
 */
export function registerWriteTools(server: McpServer, context: HingeMcpContext): void {
  const { client, config } = context;
  if (config.readOnly) {
    return;
  }

  server.registerTool(
    "hinge_like",
    {
      title: "Like a profile",
      description: "Sends a like to a profile from hinge_recommendations, hinge_standouts, or hinge_likes_received. Liking someone who already liked you creates a match. Optionally attach a comment to a specific prompt (contentId + questionText + answerText) or a photo. Set useRose to spend a rose. Irreversible; confirm with the user first.",
      inputSchema: {
        subjectId: z.string().min(1).describe("Target user id"),
        ratingToken: z.string().min(1).describe("ratingToken that came with the subject"),
        comment: z.string().max(1000).optional().describe("Optional message attached to the like"),
        contentId: z.string().optional().describe("contentId of the prompt or photo being liked"),
        questionText: z.string().optional().describe("Prompt question being liked (with contentId)"),
        answerText: z.string().optional().describe("Prompt answer being liked (with contentId)"),
        photoUrl: z.string().url().optional().describe("Photo url being liked instead of a prompt"),
        useRose: z.boolean().optional().describe("Spend a rose (superlike)"),
        origin: z.string().optional().describe("Feed origin the subject came from (default compatibles)")
      },
      annotations: WRITE
    },
    guarded(async ({ subjectId, ratingToken, comment, contentId, questionText, answerText, photoUrl, useRose, origin }) => {
      const result = await client.ratings.rateUser({
        subjectId,
        ratingToken,
        ...(comment ? { comment } : {}),
        ...(contentId ? { contentId } : {}),
        ...(questionText ? { questionText } : {}),
        ...(answerText ? { answerText } : {}),
        ...(photoUrl ? { photo: { url: photoUrl, ...(contentId ? { contentId } : {}) } } : {}),
        ...(useRose ? { useSuperlike: true } : {}),
        ...(origin ? { origin } : {})
      });
      return jsonResult({ status: "liked", subjectId, usedRose: Boolean(useRose), response: result });
    })
  );

  server.registerTool(
    "hinge_skip",
    {
      title: "Skip a profile",
      description: "Passes on a profile from hinge_recommendations or hinge_likes_received. The profile is removed from the feed. Irreversible; confirm with the user first.",
      inputSchema: {
        subjectId: z.string().min(1).describe("Target user id"),
        ratingToken: z.string().min(1).describe("ratingToken that came with the subject"),
        origin: z.string().optional().describe("Feed origin the subject came from (default compatibles)")
      },
      annotations: { ...WRITE, destructiveHint: true }
    },
    guarded(async ({ subjectId, ratingToken, origin }) => {
      const result = await client.ratings.skip({ subjectId, ratingToken, ...(origin ? { origin } : {}) });
      return jsonResult({ status: "skipped", subjectId, response: result });
    })
  );

  server.registerTool(
    "hinge_send_message",
    {
      title: "Send a chat message",
      description: "Sends a text message to a match. Pass the match's user id (subjectId from hinge_matches). Irreversible; confirm the exact text with the user first.",
      inputSchema: {
        subjectId: z.string().min(1).describe("Match user id"),
        message: z.string().min(1).max(4000).describe("Message text"),
        isFirstMessage: z.boolean().optional().describe("True when this opens the conversation (default: detected from chat history)")
      },
      annotations: WRITE
    },
    guarded(async ({ subjectId, message, isFirstMessage }) => {
      await context.ensureChatSession();
      let first = isFirstMessage;
      let channelUrl: string | undefined;
      if (first === undefined) {
        try {
          channelUrl = (await client.chat.ensureDmWith(subjectId)).channelUrl;
          const history = await client.chat.messages({ channelUrl, messageTs: String(Date.now()), prevLimit: 1 });
          first = history.messages.length === 0;
        } catch {
          first = false;
        }
      }
      const response = await client.chat.sendMessage({
        ays: false,
        matchMessage: Boolean(first),
        messageType: "text",
        messageData: { message },
        subjectId,
        origin: "connection"
      });
      return jsonResult({ status: "sent", subjectId, channelUrl: channelUrl ?? null, message, response });
    })
  );

  server.registerTool(
    "hinge_update_preferences",
    {
      title: "Update dating preferences",
      description: "Merges the given fields into the user's dating preferences and saves them. Read hinge_preferences first; fields not given are kept. Confirm with the user first.",
      inputSchema: {
        preferences: z.record(z.unknown()).describe("Partial preferences object using the same keys hinge_preferences returns (for example maxDistance, genderedAgeRanges, dealbreakers)")
      },
      annotations: { ...WRITE, idempotentHint: true }
    },
    guarded(async ({ preferences }) => {
      const current = await client.profiles.preferences();
      const merged = { ...current.preferences, ...(preferences as Partial<Preferences>) } as Preferences;
      const response = await client.profiles.updatePreferences(merged);
      return jsonResult({ status: "updated", preferences: merged, response });
    })
  );

  if (config.allowRaw) {
    server.registerTool(
      "hinge_raw_request",
      {
        title: "Raw Hinge or Sendbird request",
        description: "Escape hatch: performs an authenticated request against the Hinge REST API or the Sendbird chat API and returns the raw JSON. Only available when HINGE_MCP_ALLOW_RAW=1. Use with care.",
        inputSchema: {
          service: z.enum(["hinge", "sendbird"]).describe("Which upstream API"),
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method"),
          path: z.string().min(1).describe("Path such as /likelimit or /user/v3, or an absolute url on an allowed host"),
          body: z.unknown().optional().describe("JSON body for write methods")
        },
        annotations: { ...WRITE, destructiveHint: true }
      },
      guarded(async ({ service, method, path, body }) => {
        if (service === "sendbird") {
          await context.ensureChatSession();
        }
        const response = service === "hinge"
          ? await client.raw.hinge(method as HingeHttpMethod, path, body)
          : await client.raw.sendbird(method as HingeHttpMethod, path, body);
        return jsonResult(response);
      })
    );
  }
}
