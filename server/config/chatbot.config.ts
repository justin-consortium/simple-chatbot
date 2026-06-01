import fs from 'fs';
import path from 'path';

interface ChatbotConfig {
  name: string;
  systemPrompt: string;
  historyWindowSize: number;
  model: string;
  temperature: number;
  maxTokens: number;
}

const knowledgeDir = path.join(__dirname, '../knowledge');

const systemPrompt = fs.readFileSync(
  path.join(knowledgeDir, 'system-prompt.txt'),
  'utf-8'
).trim();

const docsDir = path.join(knowledgeDir, 'docs');
const docRules = fs.readdirSync(docsDir)
  .filter(f => f.endsWith('.txt') || f.endsWith('.md'))
  .map(f => fs.readFileSync(path.join(docsDir, f), 'utf-8').trim())
  .filter(Boolean)
  .join('\n\n');

const fullSystemPrompt = docRules ? `${systemPrompt}\n\n${docRules}` : systemPrompt;

const config: ChatbotConfig = {
  name: 'Companion',
  systemPrompt: fullSystemPrompt,

  // Number of recent messages (user + assistant combined) to include per turn.
  // Increase for longer memory; decrease to reduce token usage.
  historyWindowSize: 20,

  // OpenAI model — change to 'gpt-4o-mini', 'gpt-4-turbo', etc.
  model: 'gpt-4o',

  temperature: 0.7,
  maxTokens: 1024,
};

export default config;
