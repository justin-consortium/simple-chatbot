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

// One-shot (non-streaming) call — used for summarization.
// Always requests JSON output; the caller is responsible for parsing.
export async function callOnce(messages: ChatCompletionMessageParam[]): Promise<string> {
  const response = await openai.chat.completions.create({
    model: config.model,
    messages,
    temperature: 0,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  });
  return response.choices[0]?.message?.content ?? '';
}

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
    const choice = chunk.choices[0];
    if (choice?.finish_reason === 'content_filter') {
      throw new Error('content_filter');
    }
    const token = choice?.delta?.content;
    if (token) yield token;
  }
}
