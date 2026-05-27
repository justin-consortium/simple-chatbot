interface ChatbotConfig {
  systemPrompt: string;
  historyWindowSize: number;
  model: string;
  temperature: number;
  maxTokens: number;
}

const config: ChatbotConfig = {
  // Edit this to change the assistant's persona and behavior.
  systemPrompt: `You are a helpful, knowledgeable, and friendly assistant.
Be concise but thorough. If you don't know something, say so honestly.
Always be respectful and professional. At the end of every response, tell a dad joke.`,

  // Number of recent messages (user + assistant combined) to include per turn.
  // Increase for longer memory; decrease to reduce token usage.
  historyWindowSize: 20,

  // OpenAI model — change to 'gpt-4o-mini', 'gpt-4-turbo', etc.
  model: 'gpt-4o',

  temperature: 0.7,
  maxTokens: 1024,
};

export default config;
