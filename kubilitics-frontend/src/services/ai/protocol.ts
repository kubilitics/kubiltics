// Outbound (frontend → backend WS handler):
export type ClientFrame =
  | { type: 'user_message'; payload: { text: string; session_id: string; turn_id: string; context_hint?: string } }
  | { type: 'cancel_turn'; payload: { session_id: string; turn_id: string } };

// Inbound (backend → frontend):
export type ServerFrame =
  | { type: 'text_delta'; payload: { anchor_id: string; text: string } }
  | { type: 'done'; payload: { anchor_id: string; prompt_tokens: number; completion_tokens: number } }
  | { type: 'error'; payload: { code: string; message: string } }
  // Forward-compat (subproject 3 emits these; v1 maps to UnknownBlock):
  | { type: 'tool_start'; payload: unknown }
  | { type: 'tool_end'; payload: unknown }
  | { type: 'action_pending'; payload: unknown }
  | { type: 'plan_proposed'; payload: unknown }
  | { type: 'citation'; payload: unknown };
