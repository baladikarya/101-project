export class WorkflowEntrypoint<E = unknown, P = unknown> {
  constructor(
    public ctx: unknown,
    public env: E,
  ) {}
  async run(_event: unknown, _step: unknown): Promise<unknown> {
    return undefined as P;
  }
}
