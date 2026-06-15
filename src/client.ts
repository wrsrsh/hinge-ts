import { Email2FAError, HingeError } from "./errors.js";
import { toApiEnumArray, toApiEnumValue } from "./enums.js";
import type { HingeLogger } from "./logger.js";
import { defaultSettings, type HingeSettings } from "./settings.js";
import { MemoryStorage, type HingeStorage, type SecretStore } from "./storage.js";
import type {
  AccountInfo,
  AnswerContentPayload,
  AnswerEvaluateRequest,
  AuthSettings,
  ConnectionDetailApi,
  ConnectionsResponse,
  CreatePromptPollRequest,
  CreatePromptPollResponse,
  CreateVideoPromptRequest,
  CreateVideoPromptResponse,
  DeviceProfile,
  ExportChatInput,
  ExportChatResult,
  ExportStatus,
  HingeAuthToken,
  HingeHttpMethod,
  JsonValue,
  LikeItemV2,
  LikeLimit,
  LikeResponse,
  LikesV2Response,
  LoginTokens,
  MatchNoteResponse,
  NotificationSettings,
  PersistedSession,
  Preferences,
  PreferencesResponse,
  ProfileContentFull,
  ProfileUpdate,
  PromptsResponse,
  PublicUserProfile,
  RateInput,
  RateRespondRequest,
  RateRespondResponse,
  RecommendationSubject,
  RecommendationsFeed,
  RecommendationsResponse,
  RecsFetchConfig,
  RecsV2Params,
  RedactedSecret,
  SelfContentResponse,
  SelfProfileResponse,
  SendMessagePayload,
  SendbirdAuthToken,
  SendbirdChannelHandle,
  SendbirdChannelsResponse,
  SendbirdCloseRequest,
  SendbirdGetMessagesInput,
  SendbirdGroupChannel,
  SendbirdMessage,
  SendbirdMessagesResponse,
  SendbirdReadResponse,
  Session,
  SkipInput,
  StandoutsResponse,
  UserSettings,
  UserTrait
} from "./types.js";
import type {
  HingeTransport,
  HingeTransportRequest,
  HingeTransportResponse,
  SendbirdRealtimeConnection,
  SendbirdRealtimeTransport
} from "./transport.js";
import { HingePromptsManager } from "./prompts-manager.js";
import { parseSendbirdWsFrame, SendbirdWsSubscription, type SendbirdWsEvent } from "./ws.js";

export const DEFAULT_PUBLIC_IDS_BATCH_SIZE = 75;

const DEFAULT_RECS_FETCH_CONFIG: RecsFetchConfig = {
  multiFetchCount: 3,
  requestDelayMs: 1500,
  rateLimitRetries: 3,
  rateLimitBackoffMs: 4000
};

export type HingeClientConfig = {
  settings?: Partial<HingeSettings>;
  recsFetchConfig?: Partial<RecsFetchConfig>;
  publicIdsBatchSize?: number;
  storage?: HingeStorage;
  secretStore?: SecretStore;
  transport?: HingeTransport;
  realtimeTransport?: SendbirdRealtimeTransport;
  logger?: HingeLogger;
};

export class ClientBuilder {
  private phone?: string;
  private config: HingeClientConfig = {};

  phoneNumber(phoneNumber: string): this {
    this.phone = phoneNumber;
    return this;
  }

  settings(settings: Partial<HingeSettings>): this {
    this.config.settings = settings;
    return this;
  }

  recsFetchConfig(config: Partial<RecsFetchConfig>): this {
    this.config.recsFetchConfig = config;
    return this;
  }

  publicIdsBatchSize(batchSize: number): this {
    this.config.publicIdsBatchSize = Math.max(1, batchSize);
    return this;
  }

  storage(storage: HingeStorage): this {
    this.config.storage = storage;
    return this;
  }

  secretStore(secretStore: SecretStore): this {
    this.config.secretStore = secretStore;
    return this;
  }

  transport(transport: HingeTransport): this {
    this.config.transport = transport;
    return this;
  }

  realtimeTransport(realtimeTransport: SendbirdRealtimeTransport): this {
    this.config.realtimeTransport = realtimeTransport;
    return this;
  }

  logger(logger: HingeLogger): this {
    this.config.logger = logger;
    return this;
  }

  build(): HingeClient {
    if (!this.phone?.trim()) {
      throw new HingeError("auth", "phone number is required");
    }
    return new HingeClient(this.phone, this.config);
  }
}

export class HingeClient {
  readonly auth = new AuthApi(this);
  readonly recommendations = new RecommendationsApi(this);
  readonly profiles = new ProfilesApi(this);
  readonly likes = new LikesApi(this);
  readonly ratings = new RatingsApi(this);
  readonly prompts = new PromptsApi(this);
  readonly connections = new ConnectionsApi(this);
  readonly settings = new SettingsApi(this);
  readonly chat = new ChatApi(this);
  readonly persistence = new PersistenceApi(this);
  readonly raw = new RawApi(this);

  config: HingeSettings;
  storage: HingeStorage;
  secretStore: SecretStore | undefined;
  transport: HingeTransport | undefined;
  realtimeTransport: SendbirdRealtimeTransport | undefined;
  logger: HingeLogger | undefined;
  phoneNumber: string;
  deviceId = randomUuid();
  installId = randomUuid();
  sessionId = randomUuid();
  installed = false;
  hingeAuth?: HingeAuthToken;
  sendbirdAuth?: SendbirdAuthToken;
  sendbirdSessionKey?: string;
  recommendationsCache = new Map<string, RecommendationSubject>();
  sessionPath: string | undefined;
  cacheDir: string | undefined;
  autoPersist = false;
  recsFetchConfig: RecsFetchConfig;
  publicIdsBatchSize: number;
  lastRecsV2Call = 0;
  private realtimeConnection: SendbirdRealtimeConnection | undefined;
  private eventHub = new EventHub();
  private pendingReadRequests = new Map<string, { resolve: (value: SendbirdReadResponse) => void; reject: (error: Error) => void }>();

  static builder(): ClientBuilder {
    return new ClientBuilder();
  }

  constructor(phoneNumber: string, config: HingeClientConfig = {}) {
    this.phoneNumber = phoneNumber;
    this.config = defaultSettings(config.settings);
    this.storage = config.storage ?? new MemoryStorage();
    this.secretStore = config.secretStore;
    this.transport = config.transport;
    this.realtimeTransport = config.realtimeTransport;
    this.logger = config.logger;
    this.recsFetchConfig = { ...DEFAULT_RECS_FETCH_CONFIG, ...config.recsFetchConfig };
    this.publicIdsBatchSize = Math.max(1, config.publicIdsBatchSize ?? DEFAULT_PUBLIC_IDS_BATCH_SIZE);
  }

  session(): Session {
    const hingeIdentityId = this.hingeAuth?.identityId;
    const session: Session = {
      phoneNumber: this.phoneNumber,
      device: {
        deviceId: this.deviceId,
        installId: this.installId,
        sessionId: this.sessionId,
        installed: this.installed
      }
    };
    if (hingeIdentityId !== undefined) {
      session.hingeIdentityId = hingeIdentityId;
    }
    if (this.hingeAuth?.token) {
      session.hingeAuthToken = redactedSecret(this.hingeAuth.token);
    }
    if (this.sendbirdAuth?.token) {
      session.sendbirdAuthToken = redactedSecret(this.sendbirdAuth.token);
    }
    if (this.sendbirdSessionKey) {
      session.sendbirdSessionKey = redactedSecret(this.sendbirdSessionKey);
    }
    return session;
  }

  setRecsFetchConfig(config: Partial<RecsFetchConfig>): void {
    this.recsFetchConfig = { ...this.recsFetchConfig, ...config };
  }

  setPublicIdsBatchSize(batchSize: number): void {
    this.publicIdsBatchSize = Math.max(1, batchSize);
  }

  hingeUserAgent(): string {
    return `Hinge/${this.config.hingeBuildNumber} CFNetwork/3859.100.1 Darwin/25.0.0`;
  }

  defaultHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "*/*",
      "accept-language": "en-GB",
      connection: "keep-alive",
      "accept-encoding": "gzip, deflate, br",
      "x-device-model-code": "iPhone15,2",
      "x-device-model": "unknown",
      "x-device-region": "IN",
      "x-session-id": this.sessionId,
      "x-device-id": this.deviceId,
      "x-install-id": this.installId,
      "x-device-platform": "iOS",
      "x-app-version": this.config.hingeAppVersion,
      "x-build-number": this.config.hingeBuildNumber,
      "x-os-version": this.config.osVersion,
      "user-agent": this.hingeUserAgent()
    };
    if (this.hingeAuth?.token) {
      headers.authorization = `Bearer ${this.hingeAuth.token}`;
    }
    return headers;
  }

  sendbirdHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "*/*",
      connection: "keep-alive",
      "accept-language": "en-GB",
      "x-session-key": this.sessionId,
      "x-device-id": this.deviceId,
      "x-install-id": this.installId,
      "sb-user-id": this.hingeAuth?.identityId ?? "",
      "request-sent-timestamp": String(Date.now()),
      sendbird: this.sendbirdHeaderValue(),
      "sb-user-agent": this.sendbirdUserAgentValue(),
      "sb-sdk-user-agent": this.sendbirdSdkUserAgentValue(),
      "user-agent": "Jios/4.26.0"
    };
    if (this.sendbirdAuth?.token) {
      headers["sb-access-token"] = this.sendbirdAuth.token;
    }
    if (this.sendbirdSessionKey) {
      headers["session-key"] = this.sendbirdSessionKey;
    }
    return headers;
  }

  sendbirdHeaderValue(): string {
    return `iOS,${this.config.osVersion},${this.config.sendbirdSdkVersion},${this.config.sendbirdAppId}`;
  }

  sendbirdUserAgentValue(): string {
    return `iOS/c${this.config.sendbirdSdkVersion}///`;
  }

  sendbirdSdkUserAgentValue(): string {
    return `main_sdk_info=chat/ios/${this.config.sendbirdSdkVersion}&device_os_platform=ios&os_version=${this.config.osVersion}`;
  }

  async requestJson<T>(service: "hinge" | "sendbird", method: HingeHttpMethod, pathOrUrl: string, body?: unknown, normalize = true): Promise<T> {
    if (!this.transport) {
      throw new HingeError("unsupported_runtime", "a HingeTransport is required; use HingeProxyTransport for browser-first full feature support");
    }
    const url = service === "hinge" ? this.hingeUrl(pathOrUrl) : this.sendbirdUrl(pathOrUrl);
    const request: HingeTransportRequest = {
      service,
      method,
      url,
      pathOrUrl,
      headers: service === "hinge" ? this.defaultHeaders() : this.sendbirdHeaders()
    };
    if (body !== undefined) {
      request.body = body as JsonValue;
    }
    const response = await this.transport.request<T>(request);
    if (response.status < 200 || response.status >= 300) {
      throw new HingeError("http", `status ${response.status}: ${JSON.stringify(response.body)}`, { status: response.status });
    }
    return (normalize ? camelizeKeys(response.body) : response.body) as T;
  }

  async requestRaw(service: "hinge" | "sendbird", method: HingeHttpMethod, pathOrUrl: string, body?: unknown): Promise<unknown> {
    return this.requestJson<unknown>(service, method, pathOrUrl, body, false);
  }

  async downloadBytes(url: string): Promise<ArrayBuffer> {
    if (!this.transport?.downloadBytes) {
      throw new HingeError("unsupported_runtime", "transport does not support byte downloads");
    }
    return this.transport.downloadBytes(url);
  }

  hingeUrl(pathOrUrl: string): string {
    if (isAbsoluteUrl(pathOrUrl)) {
      return pathOrUrl;
    }
    return `${this.config.baseUrl.replace(/\/$/, "")}/${pathOrUrl.replace(/^\//, "")}`;
  }

  sendbirdUrl(pathOrUrl: string): string {
    if (isAbsoluteUrl(pathOrUrl)) {
      return pathOrUrl;
    }
    const path = pathOrUrl.startsWith("/v3/") ? pathOrUrl : `/v3/${pathOrUrl.replace(/^\//, "")}`;
    return `${this.config.sendbirdApiUrl.replace(/\/$/, "")}${path}`;
  }

  async authenticateWithSendbird(): Promise<void> {
    if (!this.hingeAuth) {
      throw new HingeError("auth", "hinge token missing");
    }
    const token = await this.requestJson<SendbirdAuthToken>("hinge", "POST", "/message/authenticate", { refresh: false });
    this.sendbirdAuth = token;
    if (this.autoPersist && this.sessionPath) {
      await this.saveSession(this.sessionPath);
    }
  }

  async ensureSendbirdAuth(): Promise<void> {
    if (!this.sendbirdAuth || isExpired(this.sendbirdAuth.expires)) {
      await this.authenticateWithSendbird();
    }
  }

  async ensureRealtime(): Promise<SendbirdRealtimeConnection> {
    if (this.realtimeConnection) {
      return this.realtimeConnection;
    }
    if (!this.realtimeTransport) {
      throw new HingeError("unsupported_runtime", "Sendbird realtime requires a SendbirdRealtimeTransport; use ProxySendbirdRealtimeTransport in browsers");
    }
    await this.ensureSendbirdAuth();
    const userId = this.hingeAuth?.identityId ?? "";
    const url = `${this.config.sendbirdWsUrl}/?p=iOS&sv=${encodeURIComponent(this.config.sendbirdSdkVersion)}&pv=${encodeURIComponent(this.config.osVersion)}&uikit_config=0&use_local_cache=0&include_extra_data=premium_feature_list,file_upload_size_limit,emoji_hash,application_attributes,notifications,message_template,ai_agent&include_poll_details=1&user_id=${encodeURIComponent(userId)}&ai=${encodeURIComponent(this.config.sendbirdAppId)}&pmce=1&expiring_session=0&config_ts=0`;
    const headers = {
      ...(this.sendbirdSessionKey ? { "SENDBIRD-WS-AUTH": this.sendbirdSessionKey } : { "SENDBIRD-WS-TOKEN": this.sendbirdAuth?.token ?? "" }),
      accept: "*/*",
      "accept-encoding": "gzip, deflate",
      "sec-websocket-extensions": "permessage-deflate",
      "sec-websocket-version": "13",
      "request-sent-timestamp": String(Date.now()),
      origin: "https://web-sb-kr-7-704.sendbird.com",
      "accept-language": "en-GB",
      "x-session-key": this.sessionId,
      "x-device-id": this.deviceId,
      "x-install-id": this.installId,
      "sb-user-id": userId,
      "sb-access-token": this.sendbirdAuth?.token ?? "",
      sendbird: this.sendbirdHeaderValue(),
      "sb-user-agent": this.sendbirdUserAgentValue(),
      "sb-sdk-user-agent": this.sendbirdSdkUserAgentValue(),
      "user-agent": this.hingeUserAgent()
    };
    const connectRequest: Parameters<SendbirdRealtimeTransport["connect"]>[0] = {
      url,
      headers,
      userId
    };
    if (this.sendbirdAuth?.token) {
      connectRequest.token = this.sendbirdAuth.token;
    }
    if (this.sendbirdSessionKey) {
      connectRequest.sessionKey = this.sendbirdSessionKey;
    }
    const connection = await this.realtimeTransport.connect(connectRequest);
    this.realtimeConnection = connection;
    this.pumpRealtime(connection);
    return connection;
  }

  subscribeEvents(): SendbirdWsSubscription {
    return new SendbirdWsSubscription((command) => {
      this.realtimeConnection?.send(command);
    }, this.eventHub.subscribe());
  }

  sendRealtimeCommand(command: string): void {
    if (!this.realtimeConnection) {
      throw new HingeError("http", "sendbird ws not started");
    }
    this.realtimeConnection.send(command);
  }

  closeRealtime(code?: number, reason?: string): void {
    this.realtimeConnection?.close(code, reason);
    this.realtimeConnection = undefined;
    this.pendingReadRequests.clear();
  }

  async saveSession(path: string): Promise<void> {
    const session: PersistedSession = {
      phoneNumber: this.phoneNumber,
      deviceId: this.deviceId,
      installId: this.installId,
      sessionId: this.sessionId,
      installed: this.installed
    };
    if (this.hingeAuth) {
      session.hingeAuth = this.hingeAuth;
    }
    if (this.sendbirdAuth) {
      session.sendbirdAuth = this.sendbirdAuth;
    }
    if (this.sendbirdSessionKey) {
      session.sendbirdSessionKey = this.sendbirdSessionKey;
    }
    await this.storage.writeText(path, JSON.stringify(session, null, 2));
  }

  async loadSession(path: string): Promise<void> {
    if (!(await this.storage.exists(path))) {
      return;
    }
    const data = await this.storage.readText(path);
    if (!data) {
      return;
    }
    const session = JSON.parse(data) as PersistedSession;
    if (session.phoneNumber) this.phoneNumber = session.phoneNumber;
    if (session.deviceId) this.deviceId = session.deviceId;
    if (session.installId) this.installId = session.installId;
    if (session.sessionId) this.sessionId = session.sessionId;
    if (typeof session.installed === "boolean") this.installed = session.installed;
    if (session.hingeAuth) this.hingeAuth = camelizeKeys(session.hingeAuth) as HingeAuthToken;
    if (session.sendbirdAuth) this.sendbirdAuth = camelizeKeys(session.sendbirdAuth) as SendbirdAuthToken;
    if (session.sendbirdSessionKey) this.sendbirdSessionKey = session.sendbirdSessionKey;
  }

  async loadTokensSecure(): Promise<void> {
    if (!this.secretStore) {
      return;
    }
    const hinge = await this.secretStore.getSecret("hinge_auth");
    const sendbird = await this.secretStore.getSecret("sendbird_auth");
    if (hinge) {
      this.hingeAuth = camelizeKeys(JSON.parse(hinge)) as HingeAuthToken;
    }
    if (sendbird) {
      this.sendbirdAuth = camelizeKeys(JSON.parse(sendbird)) as SendbirdAuthToken;
    }
  }

  withPersistence(sessionPath?: string, cacheDir?: string, autoPersist = false): this {
    this.sessionPath = sessionPath;
    this.cacheDir = cacheDir;
    this.autoPersist = autoPersist;
    return this;
  }

  recsCachePath(): string | undefined {
    return this.cacheDir ? `${this.cacheDir.replace(/\/$/, "")}/recommendations_${this.sessionId}.json` : undefined;
  }

  promptsCachePath(): string | undefined {
    return this.cacheDir ? `${this.cacheDir.replace(/\/$/, "")}/prompts_cache.json` : undefined;
  }

  registerPendingRead(reqId: string): Promise<SendbirdReadResponse> {
    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        this.pendingReadRequests.delete(reqId);
        reject(new HingeError("http", "READ response timeout"));
      }, 5000);
      this.pendingReadRequests.set(reqId, {
        resolve: (value) => {
          globalThis.clearTimeout(timeout);
          resolve(value);
        },
        reject
      });
    });
  }

  private async pumpRealtime(connection: SendbirdRealtimeConnection): Promise<void> {
    try {
      for await (const frame of connection.events()) {
        const event = parseSendbirdWsFrame(frame);
        if (event.kind === "sessionKey") {
          this.sendbirdSessionKey = event.key;
          if (this.sessionPath) {
            await this.saveSession(this.sessionPath).catch(() => undefined);
          }
        }
        if (event.kind === "ping") {
          connection.send(`PONG${JSON.stringify({ sts: Date.now(), ts: Date.now() })}`);
        }
        if (event.kind === "read") {
          const reqId = event.reqId;
          if (reqId && this.pendingReadRequests.has(reqId)) {
            const pending = this.pendingReadRequests.get(reqId);
            this.pendingReadRequests.delete(reqId);
            pending?.resolve(camelizeKeys(event.payload) as SendbirdReadResponse);
          }
        }
        this.eventHub.publish(frame);
      }
    } catch (error) {
      this.logger?.error?.("sendbird realtime pump failed", error);
      this.eventHub.publish(`__ERROR__:${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export class AuthApi {
  constructor(private readonly client: HingeClient) {}

  async initiateSms(): Promise<void> {
    if (!this.client.installed) {
      await this.client.requestJson("hinge", "POST", "/identity/install", { installId: this.client.installId });
      this.client.installed = true;
    }
    await this.client.requestJson("hinge", "POST", "/auth/sms/v2/initiate", {
      deviceId: this.client.deviceId,
      phoneNumber: this.client.phoneNumber
    });
  }

  async submitOtp(otp: string): Promise<LoginTokens> {
    try {
      const tokens = await this.client.requestJson<LoginTokens>("hinge", "POST", "/auth/sms/v2", {
        installId: this.client.installId,
        deviceId: this.client.deviceId,
        phoneNumber: this.client.phoneNumber,
        otp
      });
      if (tokens.hingeAuthToken) this.client.hingeAuth = tokens.hingeAuthToken;
      if (tokens.sendbirdAuthToken) this.client.sendbirdAuth = tokens.sendbirdAuthToken;
      return tokens;
    } catch (error) {
      if (error instanceof HingeError && error.status === 412) {
        const body = extractErrorBody(error);
        throw new Email2FAError(String(body.caseId ?? ""), String(body.email ?? ""));
      }
      throw error;
    }
  }

  async submitEmailCode(caseId: string, emailCode: string): Promise<LoginTokens> {
    const hingeAuth = await this.client.requestJson<HingeAuthToken>("hinge", "POST", "/auth/device/validate", {
      installId: this.client.installId,
      code: emailCode,
      caseId,
      deviceId: this.client.deviceId
    });
    this.client.hingeAuth = hingeAuth;
    await this.client.authenticateWithSendbird().catch(() => undefined);
    const tokens: LoginTokens = {};
    if (this.client.hingeAuth) tokens.hingeAuthToken = this.client.hingeAuth;
    if (this.client.sendbirdAuth) tokens.sendbirdAuthToken = this.client.sendbirdAuth;
    return tokens;
  }

  loadTokensSecure(): Promise<void> {
    return this.client.loadTokensSecure();
  }

  async isSessionValid(): Promise<boolean> {
    if (!this.client.hingeAuth) {
      this.client.logger?.warn?.("Hinge token is empty, session is invalid.");
      return false;
    }
    if (!this.client.sendbirdAuth || isExpired(this.client.sendbirdAuth.expires)) {
      try {
        await this.client.authenticateWithSendbird();
      } catch {
        return false;
      }
    }
    return !isExpired(this.client.hingeAuth.expires) && !!this.client.sendbirdAuth && !isExpired(this.client.sendbirdAuth.expires);
  }
}

export class RecommendationsApi {
  constructor(private readonly client: HingeClient) {}

  get(): Promise<RecommendationsResponse> {
    return this.getWithParams({ newHere: false, activeToday: false });
  }

  async getWithParams(params: RecsV2Params): Promise<RecommendationsResponse> {
    const identityId = this.client.hingeAuth?.identityId;
    if (!identityId) {
      throw new HingeError("auth", "hinge token missing");
    }
    const body = { playerId: identityId, newHere: params.newHere, activeToday: params.activeToday };
    const fetchCount = Math.max(1, this.client.recsFetchConfig.multiFetchCount);
    let aggregated: RecommendationsResponse | undefined;
    let completed = 0;
    let rateLimitAttempts = 0;
    while (completed < fetchCount) {
      const elapsed = Date.now() - this.client.lastRecsV2Call;
      const delayMs = this.client.recsFetchConfig.requestDelayMs;
      if (this.client.lastRecsV2Call > 0 && elapsed < delayMs) {
        await delay(delayMs - elapsed);
      }
      try {
        const response = await this.client.requestJson<RecommendationsResponse>("hinge", "POST", "/rec/v2", body);
        this.client.lastRecsV2Call = Date.now();
        aggregated = aggregated ? mergeRecommendationResponses(aggregated, response) : response;
        completed += 1;
        rateLimitAttempts = 0;
      } catch (error) {
        this.client.lastRecsV2Call = Date.now();
        if (error instanceof HingeError && (error.status === 429 || error.status === 503)) {
          rateLimitAttempts += 1;
          if (rateLimitAttempts > this.client.recsFetchConfig.rateLimitRetries) {
            break;
          }
          await delay(this.client.recsFetchConfig.rateLimitBackoffMs * 2 ** (rateLimitAttempts - 1));
          continue;
        }
        throw error;
      }
    }
    const out = normalizeRecommendationsResponse(aggregated ?? { feeds: [] });
    if (this.client.autoPersist) {
      await this.applyAndSave(out, this.client.recsCachePath());
    }
    return out;
  }

  async repeatProfiles(): Promise<unknown> {
    const out = await this.client.requestJson("hinge", "GET", "/user/repeat");
    if (this.client.autoPersist) {
      const path = this.client.recsCachePath();
      if (path) await this.save(path);
    }
    return out;
  }

  async applyAndSave(recs: RecommendationsResponse, path?: string): Promise<void> {
    for (const feed of recs.feeds) {
      for (const subject of feed.subjects) {
        subject.origin ??= feed.origin;
        if (!this.client.recommendationsCache.has(subject.subjectId)) {
          this.client.recommendationsCache.set(subject.subjectId, { ...subject });
        }
      }
    }
    if (path) {
      await this.save(path);
    }
  }

  async save(path: string): Promise<void> {
    await this.client.storage.writeText(path, JSON.stringify(Object.fromEntries(this.client.recommendationsCache), null, 2));
  }

  async load(path: string): Promise<void> {
    if (!(await this.client.storage.exists(path))) {
      return;
    }
    const text = await this.client.storage.readText(path);
    if (!text) return;
    const data = JSON.parse(text) as Record<string, RecommendationSubject>;
    this.client.recommendationsCache = new Map(Object.entries(data));
  }

  remove(subjectId: string): void {
    this.client.recommendationsCache.delete(subjectId);
  }

  cached(): ReadonlyMap<string, RecommendationSubject> {
    return this.client.recommendationsCache;
  }
}

export class ProfilesApi {
  constructor(private readonly client: HingeClient) {}

  async renderedTextForUser(userId: string): Promise<string> {
    const uid = userId.trim();
    if (!uid) return "";
    const manager = await this.client.prompts.manager().catch(() => undefined);
    const profile = (await this.public([uid]))[0];
    const content = (await this.publicContent([uid]))[0];
    return renderProfile(profile, content, manager);
  }

  me(): Promise<SelfProfileResponse> {
    return this.client.requestJson("hinge", "GET", "/user/v3");
  }

  content(): Promise<SelfContentResponse> {
    return this.client.requestJson("hinge", "GET", "/content/v2");
  }

  preferences(): Promise<PreferencesResponse> {
    return this.client.requestJson("hinge", "GET", "/preference/v2/selected");
  }

  publicRawUnfiltered(ids: string[]): Promise<unknown> {
    return this.client.requestJson("hinge", "GET", `/user/v3/public?ids=${ids.join(",")}`, undefined, false);
  }

  publicContentRawUnfiltered(ids: string[]): Promise<unknown> {
    return this.client.requestJson("hinge", "GET", `/content/v2/public?ids=${ids.join(",")}`, undefined, false);
  }

  async public(userIds: string[]): Promise<PublicUserProfile[]> {
    const batches = prepareUserIdChunks(userIds, this.client.publicIdsBatchSize);
    const out: PublicUserProfile[] = [];
    for (const batch of batches) {
      out.push(...await this.client.requestJson<PublicUserProfile[]>("hinge", "GET", `/user/v3/public?ids=${batch.join(",")}`));
    }
    return out;
  }

  async publicContent(userIds: string[]): Promise<ProfileContentFull[]> {
    const batches = prepareUserIdChunks(userIds, this.client.publicIdsBatchSize);
    const out: ProfileContentFull[] = [];
    for (const batch of batches) {
      out.push(...await this.client.requestJson<ProfileContentFull[]>("hinge", "GET", `/content/v2/public?ids=${batch.join(",")}`));
    }
    return out;
  }

  update(update: ProfileUpdate): Promise<unknown> {
    return this.client.requestJson("hinge", "PATCH", "/user/v3", { profile: profileUpdateToApiJson(update) });
  }

  updatePreferences(preferences: Preferences): Promise<unknown> {
    return this.client.requestJson("hinge", "PATCH", "/preference/v2/selected", [preferencesToApiJson(preferences)]);
  }

  updateAnswers(answers: AnswerContentPayload[]): Promise<unknown> {
    return this.client.requestJson("hinge", "PUT", "/content/v1/answers", answers as unknown);
  }

  async deleteContent(contentIds: string[]): Promise<void> {
    await this.client.requestJson("hinge", "DELETE", `/content/v1?ids=${contentIds.join(",")}`);
  }
}

export class LikesApi {
  constructor(private readonly client: HingeClient) {}

  limit(): Promise<LikeLimit> {
    return this.client.requestJson("hinge", "GET", "/likelimit");
  }

  list(): Promise<LikesV2Response> {
    return this.client.requestJson("hinge", "GET", "/like/v2");
  }

  listRaw(): Promise<unknown> {
    return this.client.requestJson("hinge", "GET", "/like/v2", undefined, false);
  }

  subject(subjectId: string): Promise<LikeItemV2> {
    return this.client.requestJson("hinge", "GET", `/like/subject/${subjectId}`);
  }

  matchNote(subjectId: string): Promise<MatchNoteResponse> {
    return this.client.requestJson("hinge", "GET", `/connection/v2/matchnote/${subjectId}`);
  }
}

export class RatingsApi {
  constructor(private readonly client: HingeClient) {}

  async skip(input: SkipInput): Promise<unknown> {
    const payload = {
      ratingId: randomUuid(),
      hcmRunId: null,
      sessionId: this.client.sessionId,
      content: null,
      created: isoNoMillis(),
      ratingToken: input.ratingToken,
      initiatedWith: null,
      rating: "skip",
      hasPairing: false,
      origin: input.origin ?? "compatibles",
      subjectId: input.subjectId
    };
    const out = await this.client.requestJson("hinge", "POST", "/rate/v2/initiate", payload);
    this.client.recommendations.remove(input.subjectId);
    return out;
  }

  async rateUser(input: RateInput): Promise<LikeResponse> {
    const hcmRunId = input.comment ? await this.runTextReview(input.comment, input.subjectId) : undefined;
    const content = input.photo ? {
      comment: input.comment,
      photo: {
        url: input.photo.url,
        contentId: input.photo.contentId,
        cdnId: input.photo.cdnId,
        boundingBox: input.photo.boundingBox,
        selfieVerified: input.photo.selfieVerified
      }
    } : {
      comment: input.comment,
      prompt: {
        answer: input.answerText ?? "",
        contentId: input.contentId,
        question: input.questionText ?? ""
      }
    };
    const payload = {
      ratingId: randomUuid(),
      hcmRunId,
      sessionId: this.client.sessionId,
      content,
      created: isoNoMillis(),
      ratingToken: input.ratingToken,
      initiatedWith: input.useSuperlike ? "superlike" : "standard",
      rating: input.comment ? "note" : "like",
      hasPairing: false,
      origin: input.origin ?? "compatibles",
      subjectId: input.subjectId
    };
    return this.client.requestJson("hinge", "POST", "/rate/v2/initiate", payload);
  }

  async respond(payload: RateRespondRequest): Promise<RateRespondResponse> {
    const body = {
      ...payload,
      ratingId: payload.ratingId ?? randomUuid(),
      sessionId: payload.sessionId ?? this.client.sessionId,
      created: payload.created ?? isoNoMillis()
    };
    return this.client.requestJson("hinge", "POST", "/rate/v2/respond", body);
  }

  private async runTextReview(text: string, receiverId: string): Promise<string> {
    const out = await this.client.requestJson<Record<string, unknown>>("hinge", "POST", "/flag/textreview", { text, receiverId });
    return typeof out.hcmRunId === "string" ? out.hcmRunId : "";
  }
}

export class PromptsApi {
  constructor(private readonly client: HingeClient) {}

  async list(): Promise<PromptsResponse> {
    const cachePath = this.client.promptsCachePath();
    if (this.client.autoPersist && cachePath && await this.client.storage.exists(cachePath)) {
      const text = await this.client.storage.readText(cachePath);
      if (text) return JSON.parse(text) as PromptsResponse;
    }
    const body = await this.payload();
    const out = await this.client.requestJson<PromptsResponse>("hinge", "POST", "/prompts", body);
    if (this.client.autoPersist && cachePath) {
      await this.client.storage.writeText(cachePath, JSON.stringify(out, null, 2)).catch(() => undefined);
    }
    return out;
  }

  async manager(): Promise<HingePromptsManager> {
    return new HingePromptsManager(await this.list());
  }

  async text(promptId: string): Promise<string> {
    return (await this.manager()).getPromptDisplayText(promptId);
  }

  async search(query: string): Promise<ReturnType<HingePromptsManager["searchPrompts"]>> {
    return (await this.manager()).searchPrompts(query);
  }

  async byCategory(categorySlug: string): Promise<ReturnType<HingePromptsManager["getPromptsByCategory"]>> {
    return (await this.manager()).getPromptsByCategory(categorySlug);
  }

  async payload(): Promise<unknown> {
    const valid = await this.client.auth.isSessionValid().catch(() => false);
    if (!valid) return {};
    const preferences = await this.client.profiles.preferences().catch(() => undefined);
    const profile = await this.client.profiles.me().catch(() => undefined);
    if (!preferences || !profile) return {};
    return {
      preferences: preferences.preferences ?? {},
      profile: promptProfilePayload(profile)
    };
  }

  evaluateAnswer(payload: AnswerEvaluateRequest): Promise<unknown> {
    return this.client.requestJson("hinge", "POST", "/content/v1/answer/evaluate", payload);
  }

  createPromptPoll(payload: CreatePromptPollRequest): Promise<CreatePromptPollResponse> {
    return this.client.requestJson("hinge", "POST", "/content/v1/prompt_poll", payload);
  }

  createVideoPrompt(payload: CreateVideoPromptRequest): Promise<CreateVideoPromptResponse> {
    return this.client.requestJson("hinge", "POST", "/content/v1/video_prompt", payload);
  }
}

export class ConnectionsApi {
  constructor(private readonly client: HingeClient) {}

  list(): Promise<ConnectionsResponse> {
    return this.client.requestJson("hinge", "GET", "/connection/v2");
  }

  detail(subjectId: string): Promise<ConnectionDetailApi> {
    return this.client.requestJson("hinge", "GET", `/connection/subject/${subjectId}`);
  }

  matchNote(subjectId: string): Promise<MatchNoteResponse> {
    return this.client.requestJson("hinge", "GET", `/connection/v2/matchnote/${subjectId}`);
  }

  standouts(): Promise<StandoutsResponse> {
    return this.client.requestJson("hinge", "GET", "/standouts/v3");
  }
}

export class SettingsApi {
  constructor(private readonly client: HingeClient) {}

  preferences(): Promise<PreferencesResponse> {
    return this.client.profiles.preferences();
  }

  updatePreferences(preferences: Preferences): Promise<unknown> {
    return this.client.profiles.updatePreferences(preferences);
  }

  content(): Promise<UserSettings> {
    return this.client.requestJson("hinge", "GET", "/content/v1/settings");
  }

  updateContent(settings: UserSettings): Promise<unknown> {
    return this.client.requestJson("hinge", "PATCH", "/content/v1/settings", settings);
  }

  updateAnswers(answers: AnswerContentPayload[]): Promise<unknown> {
    return this.client.profiles.updateAnswers(answers);
  }

  auth(): Promise<AuthSettings> {
    return this.client.requestJson("hinge", "GET", "/auth/settings");
  }

  notifications(): Promise<NotificationSettings> {
    return this.client.requestJson("hinge", "GET", "/notification/v1/settings");
  }

  userTraits(): Promise<UserTrait[]> {
    return this.client.requestJson("hinge", "GET", "/user/v2/traits");
  }

  accountInfo(): Promise<AccountInfo> {
    return this.client.requestJson("hinge", "GET", "/store/v2/account");
  }

  exportStatus(): Promise<ExportStatus> {
    return this.client.requestJson("hinge", "GET", "/user/export/status");
  }
}

export class ChatApi {
  constructor(private readonly client: HingeClient) {}

  async initFlow(): Promise<unknown> {
    await this.client.ensureSendbirdAuth();
    const userId = this.requireUserId();
    return this.channelsRaw(userId, 20);
  }

  async credentials(): Promise<{ appId: string; token: string }> {
    await this.client.ensureSendbirdAuth();
    return {
      appId: this.client.config.sendbirdAppId,
      token: this.client.sendbirdAuth?.token ?? ""
    };
  }

  channelsRaw(userId: string, limit: number): Promise<unknown> {
    return this.client.requestJson("sendbird", "GET", this.channelsPath(userId, limit), undefined, false);
  }

  channels(limit: number): Promise<SendbirdChannelsResponse> {
    const userId = this.requireUserId();
    return this.client.requestJson("sendbird", "GET", this.channelsPath(userId, clamp(limit, 1, 200)));
  }

  channelRaw(channelUrl: string): Promise<unknown> {
    return this.client.requestJson("sendbird", "GET", `/sdk/group_channels/${channelUrl}?&is_feed_channel=false&show_latest_message=false&show_metadata=false&show_empty=false&show_member=true&show_frozen=false&show_read_receipt=true&show_pinned_messages=false&include_chat_notification=false&show_delivery_receipt=true&show_conversation=true`, undefined, false);
  }

  channel(channelUrl: string): Promise<SendbirdGroupChannel> {
    return this.client.requestJson("sendbird", "GET", `/sdk/group_channels/${channelUrl}?&is_feed_channel=false&show_latest_message=false&show_metadata=false&show_empty=false&show_member=true&show_frozen=false&show_read_receipt=true&show_pinned_messages=false&include_chat_notification=false&show_delivery_receipt=true&show_conversation=true`);
  }

  messages(input: SendbirdGetMessagesInput): Promise<SendbirdMessagesResponse> {
    const messageTs = Number.parseInt(input.messageTs, 10) || 0;
    return this.client.requestJson("sendbird", "GET", `/group_channels/${input.channelUrl}/messages?&include_reply_type=all&sdk_source=external_legacy&with_sorted_meta_array=true&message_ts=${messageTs}&is_sdk=true&include_reactions_summary=true&include_parent_message_info=false&reverse=true&prev_limit=${input.prevLimit}&custom_types=%2A&include=false&next_limit=0&include_poll_details=true&show_subchannel_messages_only=false&include_thread_info=false`);
  }

  async fullMessages(channelUrl: string): Promise<SendbirdMessage[]> {
    const pageSize = 120;
    let anchor = Date.now();
    const seen = new Set<string>();
    const collected: Array<{ ts: number; message: SendbirdMessage }> = [];
    while (true) {
      const batch = await this.messages({ channelUrl, messageTs: String(anchor), prevLimit: pageSize });
      if (!batch.messages.length) break;
      let earliest = anchor;
      let added = 0;
      for (const message of batch.messages) {
        if (seen.has(message.messageId)) continue;
        seen.add(message.messageId);
        const ts = parseTimestamp(message.createdAt) ?? anchor;
        earliest = Math.min(earliest, ts - 1);
        collected.push({ ts, message });
        added += 1;
      }
      if (added === 0 || earliest >= anchor || earliest <= 0 || collected.length >= 4000) break;
      anchor = earliest;
    }
    return collected.sort((a, b) => a.ts - b.ts).map((item) => item.message);
  }

  async exportChat(input: ExportChatInput): Promise<ExportChatResult> {
    const channel = await this.channel(input.channelUrl);
    const selfUserId = this.requireUserId();
    const partner = channel.members.find((member) => member.userId && member.userId !== selfUserId);
    if (!partner) {
      throw new HingeError("http", "unable to determine conversation partner");
    }
    const [profile] = await this.client.profiles.public([partner.userId]);
    const [content] = await this.client.profiles.publicContent([partner.userId]);
    const manager = await this.client.prompts.manager().catch(() => undefined);
    const messages = await this.fullMessages(input.channelUrl);
    const displayName = profile?.profile.firstName ?? partner.nickname ?? partner.userId;
    const lines = [`Chat with ${displayName}`, `Channel: ${input.channelUrl}`, `Exported at ${new Date().toISOString()}`, ""];
    for (const message of messages) {
      const sender = message.user.userId === selfUserId ? "You" : message.user.nickname || displayName;
      const body = message.message?.trim() || message.data?.trim() || (message.customType ? `[${message.customType} message]` : "[non-text message]");
      lines.push(`${new Date(parseTimestamp(message.createdAt) ?? Date.now()).toISOString()} - ${sender}: ${body}`);
    }
    return {
      transcript: lines.join("\n"),
      profileText: renderProfile(profile, content, manager),
      messageCount: messages.length,
      mediaFiles: []
    };
  }

  async createDistinctDm(selfUserId: string, peerUserId: string, dataMm: number): Promise<unknown> {
    return this.client.requestJson("sendbird", "POST", "/group_channels?", {
      isEphemeral: false,
      isExclusive: false,
      data: `{\n  "mm" : ${dataMm}\n}`,
      userIds: [peerUserId, selfUserId],
      isSuper: false,
      isDistinct: true,
      strict: false,
      isBroadcast: false,
      messageSurvivalSeconds: -1,
      isPublic: false
    });
  }

  async getOrCreateDmChannel(selfUserId: string, peerUserId: string): Promise<string> {
    const q = `/users/${selfUserId}/my_group_channels?&members_exactly_in=${peerUserId}&show_latest_message=false&distinct_mode=all&hidden_mode=unhidden_only&show_pinned_messages=false&show_metadata=true&member_state_filter=all&user_id=${selfUserId}&is_explicit_request=true&public_mode=all&include_left_channel=false&show_conversation=false&show_frozen=true&is_feed_channel=false&show_delivery_receipt=true&unread_filter=all&super_mode=all&show_member=true&show_read_receipt=true&order=chronological&show_empty=true&include_chat_notification=false&limit=1`;
    const existing = await this.client.requestJson<{ channels?: SendbirdGroupChannel[] }>("sendbird", "GET", q);
    const channelUrl = existing.channels?.[0]?.channelUrl;
    if (channelUrl) return channelUrl;
    const created = await this.createDistinctDm(selfUserId, peerUserId, 1) as Record<string, unknown>;
    if (typeof created.channelUrl !== "string") {
      throw new HingeError("http", "missing channel_url in create response");
    }
    return created.channelUrl;
  }

  async ensureDmWith(partnerId: string): Promise<SendbirdChannelHandle> {
    return { channelUrl: await this.getOrCreateDmChannel(this.requireUserId(), partnerId) };
  }

  async sendMessage(payload: SendMessagePayload): Promise<unknown> {
    const body = { ...payload, dedupId: payload.dedupId ?? randomUuid() };
    const selfUserId = this.requireUserId();
    let channelUrl: string | undefined;
    channelUrl = await this.getOrCreateDmChannel(selfUserId, payload.subjectId).catch((error) => {
      this.client.logger?.warn?.("sendbird get-or-create failed before send", error);
      return undefined;
    });
    try {
      return await this.client.requestJson("hinge", "POST", "/message/send", body);
    } catch (error) {
      if (!channelUrl || !shouldFallbackToSendbirdSend(error)) {
        throw error;
      }
      this.client.logger?.warn?.("hinge message send failed; retrying through sendbird", error);
      return this.sendSendbirdMessage(channelUrl, body.messageData.message, body.dedupId);
    }
  }

  async sendSendbirdMessage(channelUrl: string, message: string, dedupId = randomUuid()): Promise<unknown> {
    return this.client.requestJson("sendbird", "POST", `/group_channels/${encodeURIComponent(channelUrl)}/messages`, {
      message_type: "MESG",
      user_id: this.requireUserId(),
      message,
      data: "",
      custom_type: "",
      dedup_id: dedupId
    }, false);
  }

  async subscribeEvents(): Promise<SendbirdWsSubscription> {
    await this.client.ensureRealtime();
    return this.client.subscribeEvents();
  }

  async sendWsCommand(command: string): Promise<void> {
    await this.client.ensureRealtime();
    this.client.sendRealtimeCommand(command);
  }

  async markRead(channelUrl: string): Promise<SendbirdReadResponse> {
    await this.client.ensureRealtime();
    const reqId = randomUuid();
    const response = this.client.registerPendingRead(reqId);
    this.client.sendRealtimeCommand(`READ${JSON.stringify({ req_id: reqId, channel_url: channelUrl })}`);
    return response;
  }

  async markReadFireAndForget(channelUrl: string): Promise<void> {
    await this.sendWsCommand(`READ${JSON.stringify({ req_id: randomUuid(), channel_url: channelUrl })}`);
  }

  ping(): Promise<void> {
    return this.sendWsCommand(`PING${JSON.stringify({ req_id: randomUuid() })}`);
  }

  typingStart(channelUrl: string): Promise<void> {
    return this.sendWsCommand(`TPST${JSON.stringify({ req_id: null, channel_url: channelUrl, time: Date.now() })}`);
  }

  typingEnd(channelUrl: string): Promise<void> {
    return this.sendWsCommand(`TPEN${JSON.stringify({ req_id: null, channel_url: channelUrl, time: Date.now() })}`);
  }

  enterChannel(channelUrl: string): Promise<void> {
    return this.sendWsCommand(`ENTR${JSON.stringify({ req_id: null, channel_url: channelUrl })}`);
  }

  exitChannel(channelUrl: string): Promise<void> {
    return this.sendWsCommand(`EXIT${JSON.stringify({ req_id: null, channel_url: channelUrl })}`);
  }

  ackMessage(channelUrl: string, messageId: string): Promise<void> {
    return this.sendWsCommand(`MACK${JSON.stringify({ req_id: null, channel_url: channelUrl, msg_id: messageId })}`);
  }

  async closeWs(request: SendbirdCloseRequest = {}): Promise<void> {
    this.client.closeRealtime(request.code, request.reason);
  }

  async ensureWsConnected(): Promise<boolean> {
    await this.client.ensureRealtime();
    return true;
  }

  private channelsPath(userId: string, limit: number): string {
    return `/users/${userId}/my_group_channels?&include_left_channel=false&member_state_filter=all&super_mode=all&show_latest_message=false&show_pinned_messages=false&unread_filter=all&show_delivery_receipt=true&show_conversation=false&show_member=true&show_empty=true&limit=${limit}&user_id=${userId}&is_feed_channel=false&order=latest_last_message&hidden_mode=unhidden_only&distinct_mode=all&show_read_receipt=true&show_metadata=true&is_explicit_request=true&show_frozen=true&public_mode=all&include_chat_notification=false`;
  }

  private requireUserId(): string {
    const userId = this.client.hingeAuth?.identityId;
    if (!userId) {
      throw new HingeError("auth", "hinge token missing");
    }
    return userId;
  }
}

export class PersistenceApi {
  constructor(private readonly client: HingeClient) {}

  saveSession(path: string): Promise<void> {
    return this.client.saveSession(path);
  }

  loadSession(path: string): Promise<void> {
    return this.client.loadSession(path);
  }

  configure(sessionPath?: string, cacheDir?: string, autoPersist = false): HingeClient {
    this.client.withPersistence(sessionPath, cacheDir, autoPersist);
    return this.client;
  }
}

export class RawApi {
  constructor(private readonly client: HingeClient) {}

  hinge(method: HingeHttpMethod, pathOrUrl: string, body?: unknown): Promise<unknown> {
    return this.client.requestRaw("hinge", method, pathOrUrl, body);
  }

  sendbird(method: HingeHttpMethod, pathOrUrl: string, body?: unknown): Promise<unknown> {
    return this.client.requestRaw("sendbird", method, pathOrUrl, body);
  }
}

class EventHub {
  private readonly subscribers = new Set<AsyncQueue<string>>();

  subscribe(): AsyncIterable<string> {
    const queue = new AsyncQueue<string>(() => this.subscribers.delete(queue));
    this.subscribers.add(queue);
    return queue;
  }

  publish(value: string): void {
    for (const subscriber of this.subscribers) {
      subscriber.push(value);
    }
  }
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  constructor(private readonly onClose: () => void) {}

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    try {
      while (!this.closed) {
        if (this.values.length > 0) {
          yield this.values.shift() as T;
          continue;
        }
        const next = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
        if (next.done) return;
        yield next.value;
      }
    } finally {
      this.closed = true;
      this.onClose();
    }
  }
}

function randomUuid(): string {
  return globalThis.crypto?.randomUUID?.().toUpperCase() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }).toUpperCase();
}

function redactedSecret(value: string): RedactedSecret {
  const out: RedactedSecret = { redacted: true };
  if (value) {
    return { ...out, hint: `***${value.slice(-4)}` };
  }
  return out;
}

function isExpired(expires: string): boolean {
  const time = Date.parse(expires);
  return Number.isFinite(time) ? time <= Date.now() : true;
}

function isAbsoluteUrl(pathOrUrl: string): boolean {
  return pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://");
}

function shouldFallbackToSendbirdSend(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { kind?: unknown; status?: unknown };
  return candidate.kind === "http" && (candidate.status === 400 || candidate.status === 404);
}

function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelizeKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[camelKey(key)] = camelizeKeys(nested);
  }
  return out;
}

function camelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function mergeRecommendationResponses(base: RecommendationsResponse, additional: RecommendationsResponse): RecommendationsResponse {
  const feeds = [...base.feeds.map((feed) => ({ ...feed, subjects: [...feed.subjects] }))];
  const feedIndex = new Map(feeds.map((feed, index) => [feed.origin, index]));
  for (const feed of additional.feeds) {
    const existingIndex = feedIndex.get(feed.origin);
    if (existingIndex === undefined) {
      feedIndex.set(feed.origin, feeds.length);
      feeds.push({ ...feed, subjects: feed.subjects.map((subject) => ({ origin: feed.origin, ...subject })) });
      continue;
    }
    const existing = feeds[existingIndex] as RecommendationsFeed;
    const seen = new Set(existing.subjects.map((subject) => subject.subjectId));
    for (const subject of feed.subjects) {
      if (!seen.has(subject.subjectId)) {
        seen.add(subject.subjectId);
        existing.subjects.push({ origin: feed.origin, ...subject });
      }
    }
    if (existing.permission === undefined && feed.permission !== undefined) {
      existing.permission = feed.permission;
    }
    if (existing.preview === undefined && feed.preview !== undefined) {
      existing.preview = feed.preview;
    }
  }
  const activePills = mergeById(base.activePills, additional.activePills);
  const out: RecommendationsResponse = { feeds };
  if (activePills) out.activePills = activePills;
  out.cacheControl = base.cacheControl ?? additional.cacheControl;
  return out;
}

function normalizeRecommendationsResponse(response: RecommendationsResponse): RecommendationsResponse {
  const ordered: RecommendationSubject[] = [];
  const seen = new Set<string>();
  for (const feed of response.feeds) {
    for (const subject of feed.subjects) {
      if (!seen.has(subject.subjectId)) {
        seen.add(subject.subjectId);
        ordered.push({ origin: feed.origin, ...subject });
      }
    }
  }
  const first = response.feeds[0];
  const feed: RecommendationsFeed = {
    id: 0,
    origin: first?.origin ?? "combined",
    subjects: ordered
  };
  if (first && first.permission !== undefined) feed.permission = first.permission;
  if (first && first.preview !== undefined) feed.preview = first.preview;
  const out: RecommendationsResponse = { feeds: [feed] };
  if (response.activePills !== undefined) out.activePills = response.activePills;
  if (response.cacheControl !== undefined) out.cacheControl = response.cacheControl;
  return out;
}

function mergeById<T extends { id: string }>(base?: T[], additional?: T[]): T[] | undefined {
  if (!base && !additional) return undefined;
  const out = [...(base ?? [])];
  const seen = new Set(out.map((item) => item.id));
  for (const item of additional ?? []) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function prepareUserIdChunks(userIds: string[], batchSize: number): string[][] {
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const raw of userIds) {
    const id = raw.trim();
    const valid = /^\d+$/.test(id) || /^[a-fA-F0-9]{32}$/.test(id);
    if (valid && !seen.has(id)) {
      seen.add(id);
      accepted.push(id);
    }
  }
  const out: string[][] = [];
  for (let i = 0; i < accepted.length; i += batchSize) {
    out.push(accepted.slice(i, i + batchSize));
  }
  return out;
}

function profileUpdateToApiJson(update: ProfileUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visibleFields: Array<[keyof ProfileUpdate, string]> = [
    ["children", "children"],
    ["datingIntention", "datingIntentions"],
    ["drinking", "drinking"],
    ["drugs", "drugs"],
    ["marijuana", "marijuana"],
    ["smoking", "smoking"],
    ["politics", "politics"]
  ];
  for (const [key, enumField] of visibleFields) {
    const value = update[key] as { value: string; visible: boolean } | undefined;
    if (value) {
      out[key] = { value: toApiEnumValue(enumField, value.value), visible: value.visible };
    }
  }
  if (update.religions) out.religions = { value: toApiEnumArray("religions", update.religions.value), visible: update.religions.visible };
  if (update.ethnicities) out.ethnicities = { value: toApiEnumArray("ethnicities", update.ethnicities.value), visible: update.ethnicities.visible };
  if (update.educationAttained) out.educationAttained = toApiEnumValue("educationAttained", update.educationAttained);
  if (update.relationshipTypeIds) out.relationshipTypeIds = { value: toApiEnumArray("relationshipTypes", update.relationshipTypeIds.value), visible: update.relationshipTypeIds.visible };
  if (update.height !== undefined) out.height = update.height;
  if (update.genderId) out.genderId = toApiEnumValue("genderId", update.genderId);
  if (update.hometown) out.hometown = update.hometown;
  if (update.languagesSpoken) out.languagesSpoken = update.languagesSpoken;
  if (update.zodiac) out.zodiac = update.zodiac;
  return out;
}

function preferencesToApiJson(preferences: Preferences): Record<string, unknown> {
  return {
    genderedAgeRanges: preferences.genderedAgeRanges,
    dealbreakers: preferences.dealbreakers,
    religions: toApiEnumArray("religions", preferences.religions),
    drinking: toApiEnumArray("drinking", preferences.drinking),
    genderedHeightRanges: preferences.genderedHeightRanges,
    marijuana: toApiEnumArray("marijuana", preferences.marijuana),
    relationshipTypes: toApiEnumArray("relationshipTypes", preferences.relationshipTypes),
    drugs: toApiEnumArray("drugs", preferences.drugs),
    maxDistance: preferences.maxDistance,
    children: toApiEnumArray("children", preferences.children),
    ethnicities: toApiEnumArray("ethnicities", preferences.ethnicities),
    smoking: toApiEnumArray("smoking", preferences.smoking),
    educationAttained: toApiEnumArray("educationAttained", preferences.educationAttained),
    familyPlans: preferences.familyPlans,
    datingIntentions: toApiEnumArray("datingIntentions", preferences.datingIntentions),
    politics: toApiEnumArray("politics", preferences.politics),
    genderPreferences: toApiEnumArray("genderPreferences", preferences.genderPreferences)
  };
}

function promptProfilePayload(profile: SelfProfileResponse): Record<string, unknown> {
  const unwrapped = unwrapVisible(profile.content ?? {});
  const content = unwrapped && typeof unwrapped === "object" ? unwrapped as Record<string, unknown> : {};
  return {
    ...content,
    userId: profile.userId,
    didJustJoin: false,
    content: {},
    location: typeof content.location === "object" && content.location ? content.location : { name: null }
  };
}

function unwrapVisible(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(unwrapVisible);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const obj = value as Record<string, unknown>;
  if ("value" in obj && "visible" in obj) {
    return unwrapVisible(obj.value);
  }
  return Object.fromEntries(Object.entries(obj).map(([key, nested]) => [key, unwrapVisible(nested)]));
}

function renderProfile(profile?: PublicUserProfile, content?: ProfileContentFull, manager?: HingePromptsManager): string {
  const lines: string[] = [];
  const publicProfile = profile?.profile;
  const name = publicProfile?.firstName ?? publicProfile?.name?.firstName;
  if (name) lines.push(`Name: ${name}`);
  if (publicProfile?.age) lines.push(`Age: ${publicProfile.age}`);
  if (publicProfile?.location?.name) lines.push(`Location: ${publicProfile.location.name}`);
  for (const answer of content?.content.answers ?? []) {
    const promptId = typeof answer.promptId === "string" ? answer.promptId : undefined;
    const question = answer.question ?? (promptId ? manager?.getPromptDisplayText(promptId) : undefined);
    const answerText = answer.answer;
    if (question && answerText) lines.push(`Prompt "${question}" - "${answerText}"`);
    else if (answerText) lines.push(`Prompt answer "${answerText}"`);
  }
  return lines.join("\n");
}

function parseTimestamp(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (!value) return undefined;
  const number = Number.parseInt(value, 10);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isoNoMillis(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function extractErrorBody(error: HingeError): Record<string, unknown> {
  const match = /status \d+: (.*)$/.exec(error.message);
  if (!match) return {};
  try {
    return JSON.parse(match[1] ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}
