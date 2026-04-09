/**
 * Persists chat composer draft (text + attachments) across route changes.
 * Lives at module scope — survives component unmount/remount.
 * Cleared on successful send.
 */

export interface DraftAttachment {
  file: File
  preview?: string
  pastedText?: string
}

interface ChatDraft {
  input: string
  attachments: DraftAttachment[]
}

let draft: ChatDraft = {
  input: "",
  attachments: [],
}

export function getDraft(): ChatDraft {
  return draft
}

export function saveDraft(input: string, attachments: DraftAttachment[]) {
  draft = { input, attachments }
}

export function clearDraft() {
  // Revoke object URLs to prevent memory leaks
  for (const a of draft.attachments) {
    if (a.preview) URL.revokeObjectURL(a.preview)
  }
  draft = { input: "", attachments: [] }
}
