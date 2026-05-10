import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DaemonClient } from './daemonClient.js';

export function registerTools(server: Server, daemonUrl: string): void {
  const client = new DaemonClient(daemonUrl);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'open_page',
        description: 'Open a TSX page in the visual editor preview. Returns a URL the user can visit.',
        inputSchema: {
          type: 'object',
          required: ['root', 'page'],
          properties: {
            root: { type: 'string', description: 'Absolute path to the project root' },
            page: { type: 'string', description: 'Page file path (e.g. src/pages/Home.tsx) or route' },
          },
        },
      },
      {
        name: 'close_preview',
        description: 'Close an active preview session by sessionId.',
        inputSchema: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string' } },
        },
      },
      {
        name: 'get_status',
        description: 'Return daemon status: version, uptime, active previews.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'rollback',
        description: 'Restore a file to its pre-commit content using the commit id from a prior visual-edit commit.',
        inputSchema: {
          type: 'object',
          required: ['commitId'],
          properties: { commitId: { type: 'string', description: 'The commit id to roll back' } },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (name === 'open_page') {
      const result = await client.openPreview({ root: args.root as string, page: args.page as string });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    if (name === 'close_preview') {
      await client.closePreview({ sessionId: args.sessionId as string });
      return { content: [{ type: 'text', text: 'closed' }] };
    }
    if (name === 'get_status') {
      const status = await client.getStatus();
      return { content: [{ type: 'text', text: JSON.stringify(status) }] };
    }
    if (name === 'rollback') {
      await client.rollback(args.commitId as string);
      return { content: [{ type: 'text', text: `rolled back commit ${args.commitId as string}` }] };
    }
    throw new Error(`unknown tool: ${name}`);
  });
}
