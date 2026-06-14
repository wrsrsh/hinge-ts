export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type Maybe<T> = T | undefined;

export type RedactedSecret = {
  readonly redacted: true;
  readonly hint?: string;
};

export type HingeAuthToken = {
  identityId: string;
  token: string;
  expires: string;
};

export type SendbirdAuthToken = {
  token: string;
  expires: string;
};

export type LoginTokens = {
  hingeAuthToken?: HingeAuthToken;
  sendbirdAuthToken?: SendbirdAuthToken;
};

export type DeviceProfile = {
  deviceId: string;
  installId: string;
  sessionId: string;
  installed: boolean;
};

export type Session = {
  phoneNumber: string;
  device: DeviceProfile;
  hingeIdentityId?: string;
  hingeAuthToken?: RedactedSecret;
  sendbirdAuthToken?: RedactedSecret;
  sendbirdSessionKey?: RedactedSecret;
};

export type PersistedSession = {
  phoneNumber?: string;
  deviceId?: string;
  installId?: string;
  sessionId?: string;
  installed?: boolean;
  hingeAuth?: HingeAuthToken;
  sendbirdAuth?: SendbirdAuthToken;
  sendbirdSessionKey?: string;
};

export type RecsFetchConfig = {
  multiFetchCount: number;
  requestDelayMs: number;
  rateLimitRetries: number;
  rateLimitBackoffMs: number;
};

export type RecsV2Params = {
  newHere: boolean;
  activeToday: boolean;
};

export type RecommendationSubject = {
  subjectId: string;
  ratingToken: string;
  origin?: string;
  [key: string]: unknown;
};

export type RecommendationsFeed = {
  id: number;
  origin: string;
  subjects: RecommendationSubject[];
  permission?: string;
  preview?: RecommendationsPreview;
  [key: string]: unknown;
};

export type ActivePill = {
  id: string;
  [key: string]: unknown;
};

export type RecommendationsPreview = {
  [key: string]: unknown;
};

export type RecommendationsResponse = {
  feeds: RecommendationsFeed[];
  activePills?: ActivePill[];
  cacheControl?: unknown;
};

export type LikeLimit = {
  likes: number;
  superlikes?: number;
};

export type Location = {
  name: string;
  latitude?: number;
  longitude?: number;
  metroArea?: string;
  metroAreaV2?: string;
  countryShort?: string;
  adminArea1Long?: string;
  adminArea1Short?: string;
  adminArea2?: string;
};

export type VisibleValue<T> = {
  value: T;
  visible: boolean;
};

export type ProfileName = {
  firstName: string;
  lastName?: string;
};

export type Coordinate = {
  x?: number;
  y?: number;
};

export type BoundingBox = {
  topLeft?: Coordinate;
  bottomRight?: Coordinate;
};

export type PhotoAsset = {
  id?: string;
  url: string;
  cdnId?: string;
  contentId?: string;
  promptId?: string;
  caption?: string;
  width?: number;
  height?: number;
  videoUrl?: string;
  selfieVerified?: boolean;
  boundingBox?: BoundingBox;
  location?: string;
  source?: string;
  sourceId?: string;
  pHash?: string;
};

export type ProfileAnswer = {
  id?: string;
  question?: string;
  answer?: string;
  promptId?: string;
  contentId?: string;
  [key: string]: unknown;
};

export type PromptPoll = {
  id?: string;
  promptId?: string;
  question?: string;
  options?: unknown[];
  [key: string]: unknown;
};

export type VideoPrompt = {
  id?: string;
  promptId?: string;
  url?: string;
  [key: string]: unknown;
};

export type Profile = {
  firstName?: string;
  lastName?: string;
  age?: number;
  birthday?: string;
  location?: Location;
  height?: number;
  [key: string]: unknown;
};

export type SelfProfileResponse = {
  userId?: string;
  profile?: Profile;
  content?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ContentData = {
  photos?: PhotoAsset[];
  answers?: ProfileAnswer[];
  promptPolls?: PromptPoll[];
  videoPrompts?: VideoPrompt[];
  [key: string]: unknown;
};

export type SelfContentResponse = {
  content: ContentData;
  [key: string]: unknown;
};

export type PreferencesResponse = {
  preferences: Preferences;
  [key: string]: unknown;
};

export type PublicProfile = Profile & {
  userId?: string;
  name?: ProfileName;
};

export type PublicUserProfile = {
  userId?: string;
  profile: PublicProfile;
  [key: string]: unknown;
};

export type ProfileContentContent = ContentData;

export type ProfileContentFull = {
  userId?: string;
  content: ProfileContentContent;
  [key: string]: unknown;
};

export type MatchNoteResponse = {
  [key: string]: unknown;
};

export type LikeRatingContentItem = {
  [key: string]: unknown;
};

export type LikeRating = {
  subjectId?: string;
  ratingToken?: string;
  content?: LikeRatingContentItem;
  [key: string]: unknown;
};

export type LikeItemV2 = {
  subjectId?: string;
  rating?: LikeRating;
  [key: string]: unknown;
};

export type LikesV2Response = {
  likes?: LikeItemV2[];
  [key: string]: unknown;
};

export type LikeResponse = {
  [key: string]: unknown;
};

export type RateRespondRequest = {
  ratingId?: string;
  sessionId?: string;
  created?: string;
  [key: string]: unknown;
};

export type RateRespondResponse = {
  [key: string]: unknown;
};

export type PhotoAssetInput = {
  url: string;
  contentId?: string;
  cdnId?: string;
  boundingBox?: BoundingBox;
  selfieVerified?: boolean;
};

export type SkipInput = {
  subjectId: string;
  ratingToken: string;
  origin?: string;
};

export type RateInput = {
  subjectId: string;
  ratingToken: string;
  origin?: string;
  comment?: string;
  answerText?: string;
  questionText?: string;
  contentId?: string;
  photo?: PhotoAssetInput;
  useSuperlike?: boolean;
};

export type CreateRateContentPrompt = {
  answer: string;
  contentId?: string;
  question: string;
};

export type CreateRateContent = {
  comment?: string;
  photo?: PhotoAsset;
  prompt?: CreateRateContentPrompt;
};

export type CreateRate = {
  ratingId: string;
  hcmRunId?: string | null;
  sessionId: string;
  content?: CreateRateContent | null;
  created: string;
  ratingToken: string;
  initiatedWith?: string | null;
  rating: string;
  hasPairing: boolean;
  origin?: string;
  subjectId: string;
};

export type VoiceAnswerPayload = {
  [key: string]: unknown;
};

export type AnswerContentPayload = {
  [key: string]: unknown;
};

export type AnswerEvaluateRequest = {
  [key: string]: unknown;
};

export type CreatePromptPollRequest = {
  [key: string]: unknown;
};

export type CreatePromptPollResponse = {
  [key: string]: unknown;
};

export type CreateVideoPromptRequest = {
  [key: string]: unknown;
};

export type CreateVideoPromptResponse = {
  [key: string]: unknown;
};

export type Prompt = {
  id: string;
  prompt: string;
  placeholder: string;
  categories: string[];
  isSelectable: boolean;
  isNew: boolean;
  [key: string]: unknown;
};

export type PromptCategory = {
  slug: string;
  name?: string;
  isVisible: boolean;
  [key: string]: unknown;
};

export type PromptsResponse = {
  prompts: Prompt[];
  categories: PromptCategory[];
  [key: string]: unknown;
};

export type RangeDetails = {
  min?: number;
  max?: number;
  [key: string]: unknown;
};

export type GenderedRange = Record<string, RangeDetails>;
export type GenderedDealbreaker = Record<string, boolean>;

export type Dealbreakers = {
  [key: string]: unknown;
};

export type Preferences = {
  genderedAgeRanges?: GenderedRange;
  dealbreakers?: Dealbreakers;
  religions?: string[];
  drinking?: string[];
  genderedHeightRanges?: GenderedRange;
  marijuana?: string[];
  relationshipTypes?: string[];
  drugs?: string[];
  maxDistance?: number;
  children?: string[];
  ethnicities?: string[];
  smoking?: string[];
  educationAttained?: string[];
  familyPlans?: unknown;
  datingIntentions?: string[];
  politics?: string[];
  genderPreferences?: string[];
  [key: string]: unknown;
};

export type ProfileUpdate = {
  children?: VisibleValue<string>;
  datingIntention?: VisibleValue<string>;
  drinking?: VisibleValue<string>;
  drugs?: VisibleValue<string>;
  marijuana?: VisibleValue<string>;
  smoking?: VisibleValue<string>;
  politics?: VisibleValue<string>;
  religions?: VisibleValue<string[]>;
  ethnicities?: VisibleValue<string[]>;
  educationAttained?: string;
  relationshipTypeIds?: VisibleValue<string[]>;
  height?: number;
  genderId?: string;
  hometown?: VisibleValue<string>;
  languagesSpoken?: VisibleValue<number[]>;
  zodiac?: VisibleValue<number>;
  [key: string]: unknown;
};

export type UserSettings = {
  [key: string]: unknown;
};

export type AuthSettings = {
  [key: string]: unknown;
};

export type NotificationSettings = {
  [key: string]: unknown;
};

export type UserTrait = {
  [key: string]: unknown;
};

export type AccountInfo = {
  [key: string]: unknown;
};

export type ExportStatus = {
  [key: string]: unknown;
};

export type RatePayload = {
  [key: string]: unknown;
};

export type RateContentPayload = {
  [key: string]: unknown;
};

export type MessageData = {
  message: string;
};

export type SendMessagePayload = {
  dedupId?: string;
  ays: boolean;
  matchMessage: boolean;
  messageType: string;
  messageData: MessageData;
  subjectId: string;
  origin: string;
};

export type StandoutMediaRef = {
  [key: string]: unknown;
};

export type StandoutContent = {
  [key: string]: unknown;
};

export type StandoutItem = {
  [key: string]: unknown;
};

export type StandoutsResponse = {
  standouts?: StandoutItem[];
  [key: string]: unknown;
};

export type SendbirdMessageMetaItem = {
  key?: string;
  value?: string;
  [key: string]: unknown;
};

export type SendbirdMessageUser = {
  userId: string;
  nickname?: string;
  profileUrl?: string;
  [key: string]: unknown;
};

export type SendbirdMessage = {
  type?: string;
  messageId: string;
  message?: string;
  data?: string;
  customType?: string;
  createdAt: string | number;
  user: SendbirdMessageUser;
  channelUrl: string;
  file?: unknown;
  sortedMetaarray?: SendbirdMessageMetaItem[];
  [key: string]: unknown;
};

export type SendbirdMessagesResponse = {
  messages: SendbirdMessage[];
  [key: string]: unknown;
};

export type SendbirdChannelMember = {
  userId: string;
  nickname?: string;
  profileUrl?: string;
  [key: string]: unknown;
};

export type SendbirdGroupChannel = {
  channelUrl: string;
  members: SendbirdChannelMember[];
  createdAt?: string | number;
  updatedAt?: string | number;
  lastMessage?: SendbirdMessage;
  [key: string]: unknown;
};

export type SendbirdChannelsResponse = {
  channels: SendbirdGroupChannel[];
  [key: string]: unknown;
};

export type SendbirdChannelsInput = {
  userId: string;
  limit?: number;
};

export type ExportChatInput = {
  channelUrl: string;
  outputDir?: string;
  includeMedia?: boolean;
  initiationSummaryLines?: string[];
};

export type ExportedMediaFile = {
  messageId: string;
  fileName: string;
  filePath?: string;
  bytes?: ArrayBuffer;
  blob?: Blob;
};

export type ExportChatResult = {
  folderPath?: string;
  transcriptPath?: string;
  profilePath?: string;
  transcript: string;
  profileText?: string;
  messageCount: number;
  mediaFiles: ExportedMediaFile[];
};

export type ConnectionPrompt = {
  [key: string]: unknown;
};

export type ConnectionVideo = {
  [key: string]: unknown;
};

export type ConnectionContentItem = {
  [key: string]: unknown;
};

export type ConnectionItem = {
  initiatorId: string;
  subjectId: string;
  [key: string]: unknown;
};

export type ConnectionDetailApi = {
  [key: string]: unknown;
};

export type ConnectionsResponse = {
  connections: ConnectionItem[];
  [key: string]: unknown;
};

export type SendbirdChannelHandle = {
  channelUrl: string;
};

export type SendbirdGetMessagesInput = {
  channelUrl: string;
  messageTs: string;
  prevLimit: number;
};

export type SendbirdReadUser = {
  userId?: string;
  [key: string]: unknown;
};

export type SendbirdReadResponse = {
  reqId?: string;
  channelUrl?: string;
  channelId?: number;
  channelType?: string;
  [key: string]: unknown;
};

export type SendbirdSyevUserData = {
  userId: string;
  nickname?: string;
  [key: string]: unknown;
};

export type SendbirdSyevEvent = {
  cat: number;
  channelUrl: string;
  channelType?: string;
  ts?: number;
  sts?: number;
  data?: SendbirdSyevUserData;
  [key: string]: unknown;
};

export type SendbirdCloseRequest = {
  code?: number;
  reason?: string;
};

export type HingeHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
