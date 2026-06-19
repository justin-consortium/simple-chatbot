interface ChatbotConfig {
  historyWindowSize: number;
  model: string;
  temperature: number;
  maxTokens: number;
}

const config: ChatbotConfig = {
  // Number of recent messages (user + assistant combined) to include per turn.
  // Increase for longer memory; decrease to reduce token usage.
  historyWindowSize: 20,

  // OpenAI model — change to 'gpt-4o-mini', 'gpt-4-turbo', etc.
  model: 'gpt-4o',

  temperature: 0.7,
  maxTokens: 1024,
};

export default config;
