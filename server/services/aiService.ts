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

// Azure OpenAI (and the UMGPT gateway on top of it) enforces content moderation
// differently from OpenAI direct: instead of a clean finish_reason or an empty
// stream, it rejects the request up front with a 400 whose message mentions its
// "content management policy". Detect that shape and normalize it to our
// content_filter signal so the crisis-resource path fires.
function isContentFilterError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? '';
  return /content management policy|content[_ ]filter|responsibleai|jailbreak/i.test(msg);
}

export async function* streamTokens(
  messages: ChatCompletionMessageParam[]
): AsyncGenerator<string> {
  let stream;
  try {
    stream = await openai.chat.completions.create({
      model: config.model,
      messages,
      stream: true,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    });
  } catch (err) {
    if (isContentFilterError(err)) throw new Error('content_filter');
    throw err;
  }

  let tokenCount = 0;
  try {
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.finish_reason === 'content_filter') {
        throw new Error('content_filter');
      }
      const token = choice?.delta?.content;
      if (token) {
        tokenCount++;
        yield token;
      }
    }
  } catch (err) {
    if ((err as Error).message === 'content_filter' || isContentFilterError(err)) {
      throw new Error('content_filter');
    }
    throw err;
  }
  // Stream completed with no tokens — some gateways silently filter the content
  // without setting finish_reason. Treat as a content filter so the crisis
  // message fires instead of the generic fallback.
  if (tokenCount === 0) {
    throw new Error('content_filter');
  }
}
