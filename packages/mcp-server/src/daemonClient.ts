import {
  OpenPreviewRequest,
  OpenPreviewResponse,
  ClosePreviewRequest,
  StatusResponse,
  RollbackRequest,
} from '@visual-edit/protocol';

export class DaemonClient {
  constructor(private baseUrl: string) {}

  async openPreview(req: OpenPreviewRequest): Promise<OpenPreviewResponse> {
    return this.post('/preview', req, OpenPreviewResponse);
  }

  async closePreview(req: ClosePreviewRequest): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!resp.ok) throw new Error(`daemon ${resp.status}: ${await resp.text()}`);
  }

  async getStatus(): Promise<StatusResponse> {
    const resp = await fetch(`${this.baseUrl}/status`);
    if (!resp.ok) throw new Error(`daemon ${resp.status}: ${await resp.text()}`);
    return StatusResponse.parse(await resp.json());
  }

  async rollback(commitId: string): Promise<void> {
    const body: RollbackRequest = { commitId };
    const resp = await fetch(`${this.baseUrl}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok && resp.status !== 204) throw new Error(`daemon ${resp.status}: ${await resp.text()}`);
  }

  private async post<TIn, TOut>(
    path: string,
    body: TIn,
    out: { parse(v: unknown): TOut },
  ): Promise<TOut> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`daemon ${resp.status}: ${await resp.text()}`);
    return out.parse(await resp.json());
  }
}
