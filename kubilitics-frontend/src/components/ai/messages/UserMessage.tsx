import type { UserTurn } from '@/stores/chatStore';

interface Props {
  turn: UserTurn;
}

export function UserMessage({ turn }: Props) {
  return (
    <div className="flex justify-end my-2">
      <div className="max-w-[80%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap select-text [&::selection]:bg-white/30 [&_*::selection]:bg-white/30">
        {turn.text}
      </div>
    </div>
  );
}
