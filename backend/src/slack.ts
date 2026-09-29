import axios from 'axios';
import { config } from './config.js';

export async function sendSlack(text: string, blocks?: unknown[]) {
  if (!config.slack.botToken || !config.slack.channelId) return { skipped: true };
  const response = await axios.post('https://slack.com/api/chat.postMessage', {
    channel: config.slack.channelId,
    text,
    ...(blocks ? { blocks } : {})
  }, {
    headers: {
      Authorization: `Bearer ${config.slack.botToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    timeout: 15_000
  });
  if (!response.data.ok) throw new Error(`Slack error: ${response.data.error ?? 'unknown_error'}`);
  return response.data;
}
