import { createFileRoute } from "@tanstack/react-router"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useRef, useState, useCallback, useEffect } from "react"
import { Send, Paperclip, X, ZoomIn, FileText, FileCode, File as FileIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toolComponents, DuplicatePrompt } from "@/components/tool-registry"
import { TriageCard } from "@/components/triage-card"
import { getDraft, saveDraft, clearDraft } from "@/lib/chat-draft"
import { apiFetch } from "@/lib/api"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

export const Route = createFileRoute("/chat")({
  component: ChatPage,
})

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB per file
const MAX_MESSAGE_SIZE = 25 * 1024 * 1024 // 25MB total
const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/x-log",
  "text/markdown",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "video/mp4",
  "video/webm",
]

// File extensions that may not have correct MIME types
const ACCEPTED_EXTENSIONS = [".md", ".log", ".txt", ".json", ".pdf", ".docx"]

const LARGE_PASTE_THRESHOLD = 500 // chars — above this, treat as attachment

interface Attachment {
  file: File
  preview?: string
  /** For pasted text attachments — shows as chip instead of image */
  pastedText?: string
}

const transport = new DefaultChatTransport({
  api: "/chat",
  credentials: "include",
})

function ChatPage() {
  const { messages, status, error, sendMessage, regenerate } = useChat({
    transport,
  })

  const initialDraft = getDraft()
  const [input, setInput] = useState(initialDraft.input)
  const [attachments, setAttachments] = useState<Attachment[]>(initialDraft.attachments)
  const [fileError, setFileError] = useState<string | null>(null)
  const [expandedFile, setExpandedFile] = useState<{
    type: "image" | "text"
    url?: string
    content?: string
    name: string
  } | null>(null)

  // Persist draft when input or attachments change
  useEffect(() => {
    saveDraft(input, attachments)
  }, [input, attachments])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isLoading = status === "submitted" || status === "streaming"

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
    }
  }, [input])

  // Validate and add file
  const addFile = useCallback(
    (file: File) => {
      setFileError(null)

    const ext = "." + file.name.split(".").pop()?.toLowerCase()
    if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.includes(ext)) {
      setFileError(`Unsupported file type: ${file.name}`)
      return
    }
      if (file.size > MAX_FILE_SIZE) {
        setFileError(
          `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 10MB)`,
        )
        return
      }

      const totalSize =
        attachments.reduce((sum, a) => sum + a.file.size, 0) + file.size
      if (totalSize > MAX_MESSAGE_SIZE) {
        setFileError("Total attachments exceed 25MB limit")
        return
      }

      const attachment: Attachment = { file }
      if (file.type.startsWith("image/")) {
        attachment.preview = URL.createObjectURL(file)
      }

      setAttachments((prev) => [...prev, attachment])
    },
    [attachments],
  )

  // Handle clipboard paste — images and large text
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items

      // Check for images first
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) addFile(file)
          return
        }
      }

      // Check for large text paste → convert to attachment chip
      const pastedText = e.clipboardData.getData("text/plain")
      if (pastedText && pastedText.length >= LARGE_PASTE_THRESHOLD) {
        e.preventDefault()
        const blob = new Blob([pastedText], { type: "text/plain" })
        const lines = pastedText.split("\n").length
        const fileName = `pasted-text-${lines}-lines.txt`
        const file = new File([blob], fileName, { type: "text/plain" })
        const attachment: Attachment = { file, pastedText }
        setAttachments((prev) => [...prev, attachment])
      }
    },
    [addFile],
  )

  // Handle file input change
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files) {
        Array.from(files).forEach(addFile)
      }
      e.target.value = ""
    },
    [addFile],
  )

  // Expand file preview
  const expandFile = useCallback((attachment: Attachment) => {
    if (attachment.preview) {
      setExpandedFile({ type: "image", url: attachment.preview, name: attachment.file.name })
      return
    }
    // Text-based files: read content
    const ext = attachment.file.name.split(".").pop()?.toLowerCase()
    const textExts = ["md", "txt", "log", "json", "ts", "tsx", "js", "csv"]
    if (attachment.pastedText) {
      setExpandedFile({ type: "text", content: attachment.pastedText, name: "Pasted text" })
    } else if (textExts.includes(ext || "")) {
      attachment.file.text().then((content) => {
        setExpandedFile({ type: "text", content, name: attachment.file.name })
      })
    } else {
      // PDF, docx — can't preview inline, just show info
      setExpandedFile({
        type: "text",
        content: `File: ${attachment.file.name}\nType: ${attachment.file.type || ext}\nSize: ${(attachment.file.size / 1024).toFixed(1)} KB\n\nPreview not available for this file type.`,
        name: attachment.file.name,
      })
    }
  }, [])

  // Remove attachment
  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const removed = prev[index]
      if (removed.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  // Handle submit
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!input.trim() && attachments.length === 0) return
      if (isLoading) return

      setFileError(null)

      // Build file parts from attachments for multimodal
      const files = attachments.map((a) => a.file)
      const fileList =
        files.length > 0
          ? (() => {
              const dt = new DataTransfer()
              files.forEach((f) => dt.items.add(f))
              return dt.files
            })()
          : undefined

      sendMessage({
        text: input.trim(),
        ...(fileList ? { files: fileList } : {}),
      })

      setInput("")
      setAttachments([])
      clearDraft()
    },
    [input, attachments, isLoading, sendMessage],
  )

  // Handle Enter key (submit on Enter, newline on Shift+Enter)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit(e as unknown as React.FormEvent)
      }
    },
    [handleSubmit],
  )

  const handleCreateTicket = async (triageData: Record<string, unknown>) => {
    try {
      await apiFetch('/workflows/triage-workflow/trigger', {
        method: 'POST',
        body: JSON.stringify({
          description: triageData.summary ?? '',
          reporterEmail: 'user@agenticengineering.lat',
          repository: 'Agentic-Engineering-Agency/triage',
        }),
      });
      console.log('[chat] Workflow triggered successfully');
    } catch (error) {
      console.error('[chat] Failed to trigger workflow:', error);
    }
  };

  const handleUpdateExisting = async (dupData: Record<string, unknown>) => {
    try {
      await apiFetch('/workflows/triage-workflow/trigger', {
        method: 'POST',
        body: JSON.stringify({
          description: `Update existing ticket: ${dupData.existingTicketTitle ?? ''}`,
          reporterEmail: 'user@agenticengineering.lat',
          repository: 'Agentic-Engineering-Agency/triage',
        }),
      });
      console.log('[chat] Update existing triggered');
    } catch (error) {
      console.error('[chat] Failed to update existing:', error);
    }
  };

  const handleCreateNew = async (dupData: Record<string, unknown>) => {
    try {
      await apiFetch('/workflows/triage-workflow/trigger', {
        method: 'POST',
        body: JSON.stringify({
          description: dupData.existingTicketTitle ?? '',
          reporterEmail: 'user@agenticengineering.lat',
          repository: 'Agentic-Engineering-Agency/triage',
        }),
      });
      console.log('[chat] Create new triggered');
    } catch (error) {
      console.error('[chat] Failed to create new:', error);
    }
  };

  const hasMessages = messages.length > 0

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {!hasMessages ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md text-center">
              <h1 className="font-heading text-3xl font-bold mb-3">
                Welcome to Triage
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Describe an incident or paste a screenshot to get started.
                <br />
                <span className="text-xs mt-1 block text-muted-foreground/70">
                  Tip: Use Ctrl+V to paste screenshots directly
                </span>
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "flex justify-end"
                    : "flex justify-start"
                }
              >
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[80%] rounded-xl bg-primary/10 px-4 py-2.5 text-sm"
                      : "max-w-[80%] rounded-xl bg-card px-4 py-2.5 text-sm shadow-neu-sm"
                  }
                >
                  {/* Render message parts */}
                  {(() => {
                    // Consolidate consecutive text parts into one block
                    const textContent = message.parts
                      .filter((p): p is { type: "text"; text: string } => p.type === "text")
                      .map((p) => p.text)
                      .join("")

                    const fileParts = message.parts.filter((p) => p.type === "file") as Array<{
                      type: "file"
                      mediaType: string
                      url: string
                      filename?: string
                    }>
                    const toolParts = message.parts.filter((p) => p.type.startsWith("tool-"))

                    return (
                      <>
                        {/* File attachments (images, docs) */}
                        {fileParts.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {fileParts.map((file, i) =>
                              file.mediaType.startsWith("image/") ? (
                                <img
                                  key={`file-${i}`}
                                  src={file.url}
                                  alt={file.filename || "Attached image"}
                                  className="max-h-48 max-w-full rounded-lg object-cover border border-border/50"
                                />
                              ) : (
                                <div
                                  key={`file-${i}`}
                                  className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2"
                                >
                                  <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground truncate max-w-40">
                                    {file.filename || file.mediaType}
                                  </span>
                                </div>
                              ),
                            )}
                          </div>
                        )}

                        {/* Text content */}
                        {textContent && (
                          message.role === "user" ? (
                            <p className="whitespace-pre-wrap">{textContent}</p>
                          ) : (
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:text-primary prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/50 prose-pre:rounded-lg prose-a:text-primary prose-strong:text-foreground">
                              <Markdown remarkPlugins={[remarkGfm]}>{textContent}</Markdown>
                            </div>
                          )
                        )}
                        {toolParts.map((part, i) => {
                          const toolPart = part as any
                          const toolKey = part.type.replace("tool-", "")
                          const ToolComponent = toolComponents[toolKey]

                          // Special handling for displayTriage with onCreateTicket wired
                          if (toolKey === 'displayTriage' && toolPart.state === 'output-available') {
                            const output = toolPart.output as Record<string, unknown>
                            return (
                              <div key={`tool-${i}`} className="mt-2">
                                <TriageCard
                                  {...(output as unknown as import("@/components/triage-card").TriageCardProps)}
                                  onCreateTicket={() => handleCreateTicket(output)}
                                />
                              </div>
                            )
                          }

                          // Special handling for displayDuplicate with onUpdateExisting/onCreateNew wired
                          if (toolKey === 'displayDuplicate' && toolPart.state === 'output-available') {
                            const output = toolPart.output as Record<string, unknown>
                            return (
                              <div key={`tool-${i}`} className="mt-2">
                                <DuplicatePrompt
                                  {...output}
                                  onUpdateExisting={() => handleUpdateExisting(output)}
                                  onCreateNew={() => handleCreateNew(output)}
                                />
                              </div>
                            )
                          }

                          if (ToolComponent) {
                            if (toolPart.state === "output-available") {
                              return (
                                <div key={`tool-${i}`} className="mt-2">
                                  <ToolComponent {...(toolPart.output ?? {})} />
                                </div>
                              )
                            }
                            if (toolPart.state === "output-error") {
                              return (
                                <div key={`tool-${i}`} className="mt-2">
                                  <ToolComponent
                                    state="error"
                                    errorMessage={toolPart.errorText ?? "Tool execution failed"}
                                  />
                                </div>
                              )
                            }
                            return (
                              <div key={`tool-${i}`} className="mt-2">
                                <ToolComponent state="loading" />
                              </div>
                            )
                          }
                          return null
                        })}
                      </>
                    )
                  })()}
                </div>
              </div>
            ))}

            {/* Loading indicator — only while waiting for first token, not during streaming */}
            {status === "submitted" && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-card px-4 py-2.5 shadow-neu-sm">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                    <div className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                    <div className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-xl border border-destructive bg-card px-4 py-2.5 text-sm shadow-neu-sm">
                  <p className="text-destructive mb-2">
                    {error.message || "Something went wrong"}
                  </p>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => regenerate()}
                  >
                    Try Again
                  </Button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* File preview lightbox */}
      {expandedFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setExpandedFile(null)}
        >
          <button
            onClick={() => setExpandedFile(null)}
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10"
          >
            <X className="h-5 w-5" />
          </button>

          {expandedFile.type === "image" && expandedFile.url && (
            <img
              src={expandedFile.url}
              alt={expandedFile.name}
              className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}

          {expandedFile.type === "text" && expandedFile.content && (
            <div
              className="max-h-[85vh] max-w-[90vw] w-full sm:w-[700px] rounded-xl bg-card shadow-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <AttachmentIcon fileName={expandedFile.name} />
                  <span className="text-sm font-medium text-foreground">
                    {expandedFile.name}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {expandedFile.content.split("\n").length} lines
                </span>
              </div>
              <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap">
                {expandedFile.content}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <div className="p-4">
        <div className="mx-auto max-w-3xl">
          {/* File error */}
          {fileError && (
            <div className="mb-2 text-xs text-destructive">{fileError}</div>
          )}

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment, i) => (
                <div
                  key={i}
                  className="group relative"
                >
                  {/* Image preview */}
                  {attachment.preview ? (
                    <button
                      type="button"
                      onClick={() => expandFile(attachment)}
                      className="relative cursor-zoom-in rounded-xl bg-muted/80 border border-border overflow-hidden h-14 w-14"
                    >
                      <img
                        src={attachment.preview}
                        alt={attachment.file.name}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                        <ZoomIn className="h-4 w-4 text-white" />
                      </span>
                    </button>
                  ) : attachment.pastedText ? (
                    /* Pasted text chip — clickable to expand */
                    <button
                      type="button"
                      onClick={() => expandFile(attachment)}
                      className="flex items-center gap-2.5 rounded-xl bg-muted/80 border border-border px-3 h-14 max-w-56 cursor-pointer hover:bg-muted transition-colors text-left"
                    >
                      <FileText className="h-5 w-5 shrink-0 text-secondary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">
                          Pasted text
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {attachment.pastedText.split("\n").length} lines · {(attachment.file.size / 1024).toFixed(1)}KB
                        </p>
                      </div>
                    </button>
                  ) : (
                    /* Document file chip — clickable to expand */
                    <button
                      type="button"
                      onClick={() => expandFile(attachment)}
                      className="flex items-center gap-2.5 rounded-xl bg-muted/80 border border-border px-3 h-14 max-w-56 cursor-pointer hover:bg-muted transition-colors text-left"
                    >
                      <AttachmentIcon fileName={attachment.file.name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">
                          {attachment.file.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {(attachment.file.size / 1024).toFixed(1)}KB
                        </p>
                      </div>
                    </button>
                  )}
                  <button
                    onClick={() => removeAttachment(i)}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input area */}
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-2 rounded-xl bg-card p-3 shadow-neu-inset">
              {/* File upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                title="Attach files"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={[...ACCEPTED_TYPES, ".md", ".log", ".pdf", ".docx"].join(",")}
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                placeholder="Describe an incident..."
                className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none max-h-40"
                rows={1}
                disabled={isLoading}
              />

              {/* Send button */}
              <Button
                type="submit"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={
                  isLoading || (!input.trim() && attachments.length === 0)
                }
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/** Icon picker for document attachments based on file extension */
function AttachmentIcon({ fileName }: { fileName: string }) {
  const ext = fileName.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "md":
    case "txt":
    case "log":
      return <FileText className="h-4 w-4 shrink-0 text-secondary" />
    case "json":
    case "ts":
    case "tsx":
    case "js":
      return <FileCode className="h-4 w-4 shrink-0 text-orange" />
    case "pdf":
      return <FileText className="h-4 w-4 shrink-0 text-coral" />
    case "docx":
    case "doc":
      return <FileText className="h-4 w-4 shrink-0 text-steel-blue" />
    default:
      return <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
  }
}
