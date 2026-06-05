import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ChatCompletionMessageParam } from 'openai/resources';
import Message from '../models/Message';
import auth from '../middleware/auth';
import { streamTokens } from '../services/aiService';
import config from '../config/chatbot.config';
import { buildSystemPrompt } from '../services/promptService';

const router = Router();

router.get('/history', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const messages = await Message.find({ userId: req.user!.id })
      .sort({ createdAt: 1 })
      .lean();
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

router.post('/message', auth, async (req: Request, res: Response): Promise<void> => {
  const { content, mode } = req.body as { content?: string; mode?: string };
  if (!content?.trim()) {
    res.status(400).json({ error: 'Message content required' });
    return;
  }

  try {
    // Persist the user's message first
    await Message.create({ userId: req.user!.id, role: 'user', content: content.trim() });

    // Fetch the history window for AI context (includes the message just saved)
    const history = await Message.find({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(config.historyWindowSize)
      .lean();

    const contextMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(mode ?? 'free', '', false) },
      ...history.reverse().map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    console.log(
      '[chat] full prompt sent to model:\n',
      JSON.stringify(contextMessages, null, 2)
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullContent = '';
    for await (const token of streamTokens(contextMessages)) {
      fullContent += token;
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }

    await Message.create({ userId: req.user!.id, role: 'assistant', content: fullContent });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process message' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
      res.end();
    }
  }
});

export default router;
