import axios from 'axios';
import { config } from './config.js';

export type AiResult = { summary: string; suggestedLabel: string; priority: 'low' | 'medium' | 'high' };

export async function triageWithGemini(input: { title: string; body: string; author: string; event: string }): Promise<AiResult | null> {
  if (!config.gemini.apiKey) return null;
  const prompt = `You are triaging a GitHub ${input.event}. Return ONLY valid JSON with keys summary, suggestedLabel, priority.\nPriority must be one of low, medium, high. Keep summary under 240 characters. Suggested label should be a short GitHub label such as bug, enhancement, question, documentation, security, or needs-review.\nTitle: ${input.title}\nAuthor: ${input.author}\nBody: ${input.body.slice(0, 8000)}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.model)}:generateContent?key=${encodeURIComponent(config.gemini.apiKey)}`;
  try {
    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    }, { timeout: 30_000 });
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
    if (!parsed.summary || !parsed.suggestedLabel || !['low', 'medium', 'high'].includes(parsed.priority)) return null;
    return parsed;
  } catch (error: any) {
    console.error(
      JSON.stringify({
        component: 'gemini',
        error: 'Gemini API request failed',
        status: error?.response?.status,
        message: error?.response?.data?.error?.message ?? error?.message
      })
    );

    return null;
  }
}
