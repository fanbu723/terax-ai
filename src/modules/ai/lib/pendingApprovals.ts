type ApprovalPart = {
  type?: string;
  state?: string;
  approval?: { id?: string };
};

type MessageLike = {
  role?: string;
  parts?: readonly ApprovalPart[];
};

/**
 * Approval ids waiting for an answer, oldest first. The keyboard shortcut
 * answers the last one, so a repeated press walks the queue newest-first.
 * Read-only outside the card that renders it.
 */
export function pendingApprovalIds(
  messages: readonly MessageLike[],
): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part.state !== "approval-requested") continue;
      const id = part.approval?.id;
      if (typeof id === "string" && id.length > 0) ids.push(id);
    }
  }
  return ids;
}
