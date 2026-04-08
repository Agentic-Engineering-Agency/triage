import { createFileRoute } from "@tanstack/react-router"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useRef, useState, useCallback, useEffect } from "react"
import { Send, Paperclip, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toolComponents } from "@/components/tool-registry"

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
  "application/json",
  "video/mp4",
  "video/webm",
]

interface Attachment {
  file: File
  preview?: string
}

const transport = new DefaultChatTransport({
  api: "/api/agents/orchestrator/stream",
  credentials: "include",
})

function ChatPage() {
  const { messages, status, error, sendMessage, regenerate } = useChat({
    transport,
  })

  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
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

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setFileError(`Unsupported file type: ${file.type}`)
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

  // Handle clipboard paste
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) addFile(file)
          break
        }
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
                      ? "max-w-[80%] rounded-xl bg-primary/20 px-4 py-2.5 text-sm"
                      : "max-w-[80%] rounded-xl bg-card px-4 py-2.5 text-sm shadow-neu-sm"
                  }
                >
                  {/* Render message parts */}
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return (
                        <p key={i} className="whitespace-pre-wrap">
                          {part.text}
                        </p>
                      )
                    }

                    // Tool UI parts — Mastra sends as tool-{toolKey}
                    // States: input-streaming → input-available → output-available / output-error
                    if (part.type.startsWith("tool-")) {
                      const toolPart = part as any
                      const toolKey = part.type.replace("tool-", "")
                      const ToolComponent = toolComponents[toolKey]

                      if (ToolComponent) {
                        if (toolPart.state === "output-available") {
                          return (
                            <div key={i} className="mt-2">
                              <ToolComponent {...(toolPart.output ?? {})} />
                            </div>
                          )
                        }
                        if (toolPart.state === "output-error") {
                          return (
                            <div key={i} className="mt-2">
                              <ToolComponent
                                state="error"
                                errorMessage={toolPart.errorText ?? "Tool execution failed"}
                              />
                            </div>
                          )
                        }
                        // input-streaming / input-available → loading skeleton
                        return (
                          <div key={i} className="mt-2">
                            <ToolComponent state="loading" />
                          </div>
                        )
                      }
                    }

                    return null
                  })}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
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
                <div className="max-w-[80%] rounded-xl border border-coral bg-card px-4 py-2.5 text-sm shadow-neu-sm">
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

      {/* Composer */}
      <div className="border-t border-border p-4">
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
                  className="group relative rounded-lg bg-muted p-1"
                >
                  {attachment.preview ? (
                    <img
                      src={attachment.preview}
                      alt={attachment.file.name}
                      className="h-16 w-16 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded bg-muted">
                      <span className="text-[10px] text-muted-foreground text-center px-1 truncate">
                        {attachment.file.name}
                      </span>
                    </div>
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
            <div className="flex items-end gap-2 rounded-xl bg-card p-3 shadow-neu-inset">
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
                accept={ACCEPTED_TYPES.join(",")}
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
