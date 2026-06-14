import { client } from "./login";

export async function readLatestChats() {
  await client.persistence.loadSession("session.json");
  const channels = await client.chat.channels(20);
  return Promise.all(
    channels.channels.map(async (channel) => ({
      channel,
      messages: await client.chat.messages({
        channelUrl: channel.channelUrl,
        messageTs: String(Date.now()),
        prevLimit: 30
      })
    }))
  );
}

export async function subscribeToChatEvents() {
  const subscription = await client.chat.subscribeEvents();
  for await (const event of subscription) {
    console.log(event);
  }
}
