import { useEffect, useState } from 'react';
import { Iframe } from './canvas/Iframe.js';
import { Overlay } from './canvas/Overlay.js';
import { AiPromptPanel } from './panels/AiPromptPanel.js';
import { PropertiesPanel } from './panels/PropertiesPanel.js';
import { connect, type WsClient } from './wsClient.js';

export function App(): JSX.Element {
  const [client, setClient] = useState<WsClient | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session');
    if (!sessionId) return;
    const wsUrl = `ws://${location.host}/ws`;
    const c = connect(wsUrl, sessionId);
    setClient(c);
    return () => c.close();
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <div className="flex flex-1">
        <div className="flex-1 relative">
          <Iframe />
          <Overlay />
        </div>
        {client && <PropertiesPanel client={client} />}
      </div>
      {client && <AiPromptPanel client={client} />}
    </div>
  );
}
