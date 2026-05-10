import { useState } from 'react';
import { useStore, type AskAiItemUI } from '../state.js';
import type { WsClient } from '../wsClient.js';

interface Props { client: Pick<WsClient, 'sendAskAI'>; }

const STATE_LABEL: Record<AskAiItemUI['state'], string> = {
  pending: 'pending',
  leased: 'in progress',
  resolved: 'done',
};

const OUTCOME_COLOR: Record<NonNullable<AskAiItemUI['outcome']>, string> = {
  committed: 'text-green-400',
  rejected: 'text-neutral-400',
  failed: 'text-red-400',
  'no-op': 'text-amber-400',
};

export function AiPromptPanel({ client }: Props): JSX.Element {
  const selectedVid = useStore((s) => s.selectedVid);
  const askAiItems = useStore((s) => s.askAiItems);
  const addAskAiItem = useStore((s) => s.addAskAiItem);
  const [prompt, setPrompt] = useState('');

  const canSubmit = !!selectedVid && prompt.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    const requestId = client.sendAskAI(selectedVid!, prompt);
    // Optimistically stage a pending entry; the daemon's ack carries the real askId,
    // which we'll match later. For 1.C we use requestId as a temporary key replaced on ack.
    addAskAiItem({
      askId: `pending:${requestId}`,
      element: selectedVid!,
      prompt,
      enqueuedAt: new Date().toISOString(),
      state: 'pending',
    });
    setPrompt('');
  };

  const items = Object.values(askAiItems).sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));

  return (
    <div className="border-t border-neutral-700 p-3 bg-neutral-900 text-neutral-100 text-sm">
      <div className="flex gap-2">
        <textarea
          data-testid="ask-ai-input"
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 resize-none"
          rows={2}
          placeholder={selectedVid ? 'Ask AI to change the selected element…' : 'Select an element first'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          data-testid="ask-ai-btn"
          disabled={!canSubmit}
          onClick={submit}
          className="px-3 py-1 bg-blue-600 disabled:bg-neutral-700 disabled:cursor-not-allowed rounded"
        >
          Ask AI
        </button>
      </div>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto text-xs">
          {items.map((it) => (
            <li
              key={it.askId}
              data-testid={`askai-item-${it.askId}`}
              className="flex justify-between gap-2 border-b border-neutral-800 py-1"
            >
              <span className="truncate">{it.prompt || '(no prompt)'}</span>
              <span className={it.outcome ? OUTCOME_COLOR[it.outcome] : 'text-neutral-400'}>
                {it.outcome ?? STATE_LABEL[it.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
