import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ChatCompletionMessageParam } from 'openai/resources';
import Message from '../models/Message';
import Summary from '../models/Summary';
import Profile from '../models/Profile';
import auth from '../middleware/auth';
import { streamTokens, callOnce } from '../services/aiService';
import { buildSystemPrompt } from '../services/promptService';
import { renderProfileContext, renderToneInstruction, renderConditionPhrase } from '../services/profileService';
import { renderTimeContext, localDateLabel } from '../services/timeService';
import { getContinueRecap } from '../services/summaryService';
import { reconcileProfile } from '../services/reconcileService';

const router = Router();

const promptsDir = path.join(__dirname, '../prompts');
const summarizePrompt = fs.readFileSync(path.join(promptsDir, 'summarize-prompt.txt'), 'utf-8').trim();
const openerFirst     = fs.readFileSync(path.join(promptsDir, 'opener_first.txt'), 'utf-8').trim();
const openerReturning = fs.readFileSync(path.join(promptsDir, 'opener_returning.txt'), 'utf-8').trim();

// GET /api/session/latest-summary
// Returns the most recent summary for the user, or null if none exists.
router.get('/latest-summary', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const latest = await Summary.findOne({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ summary: latest ?? null });
  } catch {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// POST /api/session/end
// Summarizes the session's messages and stores the result. Fire-and-forget friendly.
router.post('/end', auth, async (req: Request, res: Response): Promise<void> => {
  const { sessionId, timeZone } = req.body as { sessionId?: string; timeZone?: string };
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId required' });
    return;
  }

  try {
    const messages = await Message.find({ userId: req.user!.id, sessionId })
      .sort({ createdAt: 1 })
      .lean();

    if (messages.length < 2) {
      res.json({ success: true, skipped: true });
      return;
    }

    const transcript = messages
      .map(m => `${m.role === 'user' ? 'Caregiver' : 'Companion'}: ${m.content}`)
      .join('\n\n');

    // Frame the summarizer for this caregiver's care recipient condition, from the
    // same source as {{CONDITION}} in the system prompt — no hardcoded condition.
    const profile = await Profile.findOne({ userId: req.user!.id }).lean();
    const conditionPhrase = renderConditionPhrase(profile?.careRecipientCondition ?? '');
    // The date the conversation actually happened, taken from its own messages — not
    // when this handler runs. They differ when a force-quit session is summarized later,
    // at the start of the next visit (the session-lifecycle catch-up). The summarizer
    // resolves the caregiver's relative time references ("next Friday") against this day.
    const sessionDate = localDateLabel(timeZone, messages[messages.length - 1].createdAt);

    const summarizeMessages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: summarizePrompt
          .replace('{{CONDITION}}', conditionPhrase)
          .replace('{{SESSION_DATE}}', sessionDate),
      },
      { role: 'user',   content: transcript },
    ];

    let parsed: Record<string, unknown>;
    try {
      const raw = await callOnce(summarizeMessages);
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      console.error('[session/end] summary parse failed:', err);
      res.json({ success: true, skipped: true });
      return;
    }

    const sessionRecap = typeof parsed.sessionRecap === 'string' ? parsed.sessionRecap : '';
    if (!sessionRecap) {
      res.json({ success: true, skipped: true });
      return;
    }

    const summaryContent = {
      caregiverState:       typeof parsed.caregiverState === 'string' ? parsed.caregiverState : '',
      whatCameUp:           Array.isArray(parsed.whatCameUp) ? parsed.whatCameUp as string[] : [],
      selfCareCoping:       Array.isArray(parsed.selfCareCoping) ? parsed.selfCareCoping as { approach: string; effect: string }[] : [],
      careSituationUpdates: typeof parsed.careSituationUpdates === 'string' ? parsed.careSituationUpdates : '',
      interactionNotes:     typeof parsed.interactionNotes === 'string' ? parsed.interactionNotes : '',
      sessionRecap,
    };

    await Summary.create({ userId: req.user!.id, sessionId, summary: summaryContent });

    // Fold this session into the caregiver's living profile before responding,
    // so the next session reads an up-to-date profile and the client's "tap to
    // continue" affordance (gated on this request finishing) can't race the
    // rewrite. Best-effort: a reconcile failure keeps the prior profile.
    // Reconcile gets the real current date (when it runs) — later than sessionDate in
    // the catch-up case — so it can tell whether stored dated plans are now past.
    await reconcileProfile(req.user!.id, summaryContent, localDateLabel(timeZone));

    res.json({ success: true });
  } catch (err) {
    console.error('[session/end] error:', err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// POST /api/session/start
// Generates and streams an opening message from the agent.
router.post('/start', auth, async (req: Request, res: Response): Promise<void> => {
  const { mode, sessionId, continuedSummaryId, timeZone } = req.body as {
    mode?: string;
    sessionId?: string;
    continuedSummaryId?: string;
    timeZone?: string;
  };
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId required' });
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

    const latestSummary = await Summary.findOne({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .lean();
    const isFirstSession = !latestSummary;

    // For continue mode, use the exact summary the client pinned at session start
    // (falls back to latest). Scoped by userId inside the helper.
    const priorSummary = await getContinueRecap(req.user!.id, mode, continuedSummaryId);

    const systemPrompt = buildSystemPrompt(mode ?? 'free', profileContext, false, priorSummary, toneInstruction, conditionPhrase, timeContext);
    const openerInstruction = isFirstSession ? openerFirst : openerReturning;

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: `${systemPrompt}\n\n${openerInstruction}` },
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullContent = '';
    for await (const token of streamTokens(messages)) {
      fullContent += token;
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }

    await Message.create({
      userId: req.user!.id,
      role: 'assistant',
      content: fullContent,
      sessionId,
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[session/start] error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start session' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
      res.end();
    }
  }
});

export default router;
