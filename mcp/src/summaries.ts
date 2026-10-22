import type {
  HingeClient,
  HingePromptsManager,
  ProfileContentFull,
  PublicUserProfile,
  SendbirdGroupChannel,
  SendbirdMessage
} from "hinge-ts";

export type ProfileSummary = {
  userId: string;
  name: string | null;
  age: number | null;
  location: string | null;
  height: number | null;
  photos: Array<{ url: string; contentId: string | null; caption: string | null }>;
  prompts: Array<{ question: string | null; answer: string | null; contentId: string | null; promptId: string | null }>;
  text: string;
  profile?: PublicUserProfile["profile"];
};

export type ProfileLookup = {
  byId: Map<string, ProfileSummary>;
  ordered: ProfileSummary[];
};

/**
 * Fetches public profiles and their content in batches and folds them into a
 * compact, model-friendly summary. Missing users are skipped.
 */
export async function loadProfileSummaries(client: HingeClient, userIds: string[], options: { includeRaw?: boolean } = {}): Promise<ProfileLookup> {
  const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  const byId = new Map<string, ProfileSummary>();
  if (ids.length === 0) {
    return { byId, ordered: [] };
  }
  const manager = await client.prompts.manager().catch(() => undefined);
  const [profiles, contents] = await Promise.all([
    client.profiles.public(ids),
    client.profiles.publicContent(ids).catch(() => [] as ProfileContentFull[])
  ]);
  const contentById = new Map<string, ProfileContentFull>();
  for (const content of contents) {
    if (content.userId) contentById.set(content.userId, content);
  }
  for (const profile of profiles) {
    const userId = profile.userId ?? profile.profile?.userId;
    if (!userId) continue;
    byId.set(userId, summarizeProfile(userId, profile, contentById.get(userId), manager, options.includeRaw ?? false));
  }
  const ordered = ids.map((id) => byId.get(id)).filter((entry): entry is ProfileSummary => Boolean(entry));
  return { byId, ordered };
}

export function summarizeProfile(userId: string, profile: PublicUserProfile | undefined, content: ProfileContentFull | undefined, manager: HingePromptsManager | undefined, includeRaw: boolean): ProfileSummary {
  const publicProfile = profile?.profile;
  const name = publicProfile?.firstName ?? publicProfile?.name?.firstName ?? null;
  const prompts = (content?.content.answers ?? []).map((answer) => {
    const rawPromptId = answer.promptId ?? (answer as { questionId?: unknown }).questionId;
    const promptId = typeof rawPromptId === "string" ? rawPromptId : null;
    const question = answer.question ?? (promptId ? manager?.getPromptDisplayText(promptId) : undefined) ?? null;
    const rawResponse = answer.answer ?? (answer as { response?: unknown }).response;
    return {
      question,
      answer: typeof rawResponse === "string" ? rawResponse : null,
      contentId: answer.contentId ?? answer.id ?? null,
      promptId
    };
  });
  const photos = (content?.content.photos ?? []).map((photo) => ({
    url: photo.url,
    contentId: photo.contentId ?? photo.id ?? null,
    caption: photo.caption ?? null
  }));
  const lines: string[] = [];
  if (name) lines.push(`Name: ${name}`);
  if (publicProfile?.age) lines.push(`Age: ${publicProfile.age}`);
  if (publicProfile?.location?.name) lines.push(`Location: ${publicProfile.location.name}`);
  if (typeof publicProfile?.height === "number") lines.push(`Height: ${publicProfile.height} cm`);
  for (const key of ["jobTitle", "employer", "educationAttained", "hometown", "religion", "politics", "children", "familyPlans", "drinking", "smoking", "pronouns", "genderIdentity", "ethnicities", "languagesSpoken"]) {
    const value = publicProfile?.[key];
    const text = describeValue(value);
    if (text) lines.push(`${humanize(key)}: ${text}`);
  }
  for (const prompt of prompts) {
    if (prompt.question && prompt.answer) lines.push(`Prompt "${prompt.question}" - "${prompt.answer}"`);
    else if (prompt.answer) lines.push(`Prompt answer "${prompt.answer}"`);
  }
  if (photos.length) lines.push(`Photos: ${photos.length}`);
  const summary: ProfileSummary = {
    userId,
    name,
    age: publicProfile?.age ?? null,
    location: publicProfile?.location?.name ?? null,
    height: typeof publicProfile?.height === "number" ? publicProfile.height : null,
    photos,
    prompts,
    text: lines.join("\n")
  };
  if (includeRaw && publicProfile) {
    summary.profile = publicProfile;
  }
  return summary;
}

export function summarizeChannel(channel: SendbirdGroupChannel, selfUserId: string | undefined): Record<string, unknown> {
  const partner = channel.members.find((member) => member.userId !== selfUserId) ?? channel.members[0];
  return {
    channelUrl: channel.channelUrl,
    partnerUserId: partner?.userId ?? null,
    partnerName: partner?.nickname ?? null,
    memberCount: channel.members.length,
    unreadMessageCount: channel["unreadMessageCount"] ?? null,
    lastMessage: channel.lastMessage ? summarizeMessage(channel.lastMessage, selfUserId) : null,
    updatedAt: toIso(channel.updatedAt ?? channel.createdAt)
  };
}

export function summarizeMessage(message: SendbirdMessage, selfUserId: string | undefined): Record<string, unknown> {
  const text = message.message?.trim() || message.data?.trim() || (message.customType ? `[${message.customType} message]` : "[non-text message]");
  return {
    messageId: message.messageId,
    fromSelf: message.user?.userId === selfUserId,
    senderUserId: message.user?.userId ?? null,
    senderName: message.user?.nickname ?? null,
    text,
    customType: message.customType ?? null,
    createdAt: toIso(message.createdAt)
  };
}

export function toIso(value: string | number | undefined): string | null {
  if (value === undefined || value === null) return null;
  const number = typeof value === "number" ? value : Number.parseInt(value, 10);
  const ms = Number.isFinite(number) ? number : Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function describeValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(describeValue).filter(Boolean);
    return parts.length ? parts.join(", ") : undefined;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return describeValue(record.value);
    if ("name" in record) return describeValue(record.name);
  }
  return undefined;
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
