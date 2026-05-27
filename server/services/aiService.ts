import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources';
import config from '../config/chatbot.config';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Optional: override the base URL for proxies or institutional gateways
  // such as University of Michigan UMGPT. Leave unset to use the default
  // OpenAI endpoint.
  baseURL: process.env.OPENAI_BASE_URL,
});

// To swap providers, replace this generator's implementation while keeping
// the same interface: accepts ChatCompletionMessageParam[] and yields tokens.
export async function* streamTokens(
  messages: ChatCompletionMessageParam[]
): AsyncGenerator<string> {
  const stream = await openai.chat.completions.create({
    model: config.model,
    messages,
    stream: true,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) yield token;
  }
}
