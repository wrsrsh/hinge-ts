import {
  BrowserStorage,
  Email2FAError,
  HingeClient,
  HingeProxyTransport,
  ProxySendbirdRealtimeTransport
} from "hinge-ts";

export const client = HingeClient.builder()
  .phoneNumber("+15555550123")
  .transport(new HingeProxyTransport({ baseUrl: "/api/hinge-proxy" }))
  .realtimeTransport(new ProxySendbirdRealtimeTransport({ url: "/api/hinge-proxy/ws/sendbird" }))
  .storage(new BrowserStorage())
  .build();

export async function loginWithSms(otp: string, emailCode?: string) {
  await client.auth.initiateSms();
  try {
    await client.auth.submitOtp(otp);
  } catch (error) {
    if (error instanceof Email2FAError && emailCode) {
      await client.auth.submitEmailCode(error.caseId, emailCode);
    } else {
      throw error;
    }
  }
  await client.persistence.saveSession("session.json");
}

export async function loadRecommendations() {
  await client.persistence.loadSession("session.json");
  return client.recommendations.get();
}
