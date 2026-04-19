// Minimal stub — fully implemented in T3.
export type ServerFrame =
  | { type: 'text_delta'; payload: { anchor_id: string; text: string } }
  | { type: 'done'; payload: { anchor_id: string; prompt_tokens: number; completion_tokens: number } }
  | { type: 'error'; payload: { code: string; message: string } }
  | { type: string; payload: unknown };
