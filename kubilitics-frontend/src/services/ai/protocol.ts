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
  | { type: 'citation'; payload: unknown }
  // render_block carries opaque structured data emitted by the brain
  // for tools classified as Deterministic. The frontend renders
  // payload.render.data directly via the type-keyed dispatcher in
  // components/ai/messages/blocks/RenderBlock.tsx — no LLM
  // paraphrasing is involved, so the values are byte-equal to what
  // the brain shaper produced. payload.summary is an optional
  // ≤80-char single-line description.
  | {
      type: 'render_block';
      payload: {
        anchor_id: string;
        render: { type: string; data: unknown };
        summary?: string;
      };
    };
