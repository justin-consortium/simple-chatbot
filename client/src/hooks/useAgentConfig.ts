import { useState, useEffect } from 'react';

export function useAgentConfig() {
  const [agentName, setAgentName] = useState('');

  useEffect(() => {
    fetch('/api/agent')
      .then(res => res.json())
      .then((data: { name: string }) => setAgentName(data.name))
      .catch(() => setAgentName('Companion'));
  }, []);

  return { agentName };
}
