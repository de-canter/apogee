export class RulesError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'RulesError';
  }
}
