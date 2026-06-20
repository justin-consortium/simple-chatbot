import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ChatCompletionMessageParam } from 'openai/resources';
import Message from '../models/Message';
import auth from '../middleware/auth';
import { streamTokens } from '../services/aiService';
import { buildSystemPrompt } from '../services/promptService';
import { renderProfileContext, renderToneInstruction, renderConditionPhrase } from '../services/profileService';
import { renderTimeContext } from '../services/timeService';
import { getContinueRecap } from '../services/summaryService';
import Profile from '../models/Profile';

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
  const { content, mode, sessionId, continuedSummaryId, timeZone } = req.body as {
    content?: string;
    mode?: string;
    sessionId?: string;
    continuedSummaryId?: string;
    timeZone?: string;
  };
  if (!content?.trim()) {
    res.status(400).json({ error: 'Message content required' });
    return;
  }

  try {
    const profile = await Profile.findOne({ userId: req.user!.id }).lean();
    const profileContext = profile ? renderProfileContext(profile) : '';
    const toneInstruction = profile ? renderToneInstruction(profile.tone) : '';
    const conditionPhrase = renderConditionPhrase(profile?.careRecipientCondition ?? '');
    // "Last conversation" anchor: most recent message outside the current session.
    const lastPrior = await Message.findOne({ userId: req.user!.id, sessionId: { $ne: sessionId } })
      .sort({ createdAt: -1 })
      .lean();
    const timeContext = renderTimeContext({ timeZone, lastSessionAt: lastPrior?.createdAt ?? null });
    // For continue mode, re-inject the pinned prior-session recap on every turn
    // (not just at session start), so the thread persists through the session.
    const priorSummary = await getContinueRecap(req.user!.id, mode, continuedSummaryId);

    // Persist the user's message first
    await Message.create({ userId: req.user!.id, role: 'user', content: content.trim(), sessionId });

    // Fetch the full current session's messages for context.
    // Scoped to sessionId so a new session never bleeds in the previous session's raw messages.
    // Cross-session continuity comes from {{PROFILE_CONTEXT}} and (for continue) the pinned
    // prior-session recap injected via priorSummary above.
    // Cap at 200 turns to guard against context overflow on very long sessions.
    const SESSION_MESSAGE_CAP = 200;
    const history = await Message.find({ userId: req.user!.id, sessionId: sessionId ?? null })
      .sort({ createdAt: 1 })
      .limit(SESSION_MESSAGE_CAP)
      .lean();

    const contextMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(mode ?? 'free', profileContext, false, priorSummary, toneInstruction, conditionPhrase, timeContext) },
      ...history.map(m => ({
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

    const FILTERED_FALLBACK = "I hear that something difficult is weighing on you. I'm here — take your time.";
    const MAX_STREAM_ATTEMPTS = 2;

    let fullContent = '';
    let contentFiltered = false;

    // An empty stream is ambiguous: usually a transient gateway hiccup, sometimes
    // a silently-filtered response. Retry once when nothing came through (safe —
    // no tokens were sent to the client yet), and only fall back to the supportive
    // message if it's still empty or was an explicit content filter.
    for (let attempt = 1; attempt <= MAX_STREAM_ATTEMPTS; attempt++) {
      try {
        for await (const token of streamTokens(contextMessages)) {
          fullContent += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      } catch (streamErr) {
        if ((streamErr as Error).message !== 'content_filter') throw streamErr;
        contentFiltered = true;
      }
      if (fullContent || contentFiltered) break;
      console.warn(`[chat] empty stream on attempt ${attempt}/${MAX_STREAM_ATTEMPTS}, retrying`);
    }

    if (!fullContent) {
      fullContent = FILTERED_FALLBACK;
      res.write(`data: ${JSON.stringify({ token: fullContent })}\n\n`);
    }

    await Message.create({ userId: req.user!.id, role: 'assistant', content: fullContent, sessionId });

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
