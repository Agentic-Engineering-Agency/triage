import { createFileRoute } from "@tanstack/react-router"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useRef, useState, useCallback, useEffect, useMemo } from "react"
import { Send, Paperclip, X, ZoomIn, FileText, FileCode, File as FileIcon, Brain, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toolComponents, DuplicatePrompt } from "@/components/tool-registry"
import { TriageCard } from "@/components/triage-card"
import { getDraft, saveDraft, clearDraft } from "@/lib/chat-draft"
import { useAuth } from "@/hooks/use-auth"
import { useConversations } from "@/hooks/use-conversations"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

export const Route = createFileRoute("/chat")({
  component: ChatPage,
})

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_MESSAGE_SIZE = 25 * 1024 * 1024
const ACCEPTED_TYPES = [
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "text/plain", "text/x-log", "text/markdown",
  "application/json", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "video/mp4", "video/webm",
]
const ACCEPTED_EXTENSIONS = [".md", ".log", ".txt", ".json", ".pdf", ".docx"]
const LARGE_PASTE_THRESHOLD = 500

interface Attachment {
  file: File
  preview?: string
  pastedText?: string
}

function ChatPage() {
  const { user } = useAuth()
  const { activeThreadId, updateTitle, ensureConversation, refreshConversations } = useConversations()

  const threadIdRef = useRef(activeThreadId)
  threadIdRef.current = activeThreadId

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/chat",
    credentials: "include",
    body: () => ({
      memory: {
        thread: threadIdRef.current,
        resource: user?.id ?? "anonymous",
      },
    }),
  }), [user?.id])

  const { messages, status, error, sendMessage, regenerate, setMessages } = useChat({
    transport,
    id: activeThreadId,
  })

  // Load messages from server when switching threads
  const prevThreadRef = useRef<string | null>(null)
  useEffect(() => {
    // Skip if we're staying on the same thread (avoids re-fetch during streaming)
    if (prevThreadRef.current === activeThreadId) return
    prevThreadRef.current = activeThreadId

    const controller = new AbortController()
    fetch(`/api/memory/threads/${activeThreadId}/messages?agentId=orchestrator`, { credentials: "include", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { messages?: Array<Record<string, unknown>> } | null) => {
        if (!data?.messages?.length) {
          // New thread with no messages — clear any stale UI messages
          setMessages([])
          return
        }
        // Convert Mastra DB messages to UIMessage format
        const uiMessages = data.messages
          .filter((m: Record<string, unknown>) => m.role === "user" || m.role === "assistant")
          .map((m: Record<string, unknown>) => {
            const content = m.content as { parts?: Array<Record<string, unknown>>; content?: string; format?: number } | string
            let parts: Array<Record<string, unknown>>
            if (typeof content === "string") {
              parts = [{ type: "text", text: content }]
            } else if (content && typeof content === "object" && Array.isArray(content.parts)) {
              parts = content.parts
            } else if (content && typeof content === "object" && typeof content.content === "string") {
              parts = [{ type: "text", text: content.content }]
            } else {
              parts = [{ type: "text", text: String(content ?? "") }]
            }
            return {
              id: m.id as string,
              role: m.role as "user" | "assistant",
              parts,
              createdAt: m.createdAt ? new Date(m.createdAt as string) : new Date(),
            }
          })
        setMessages(uiMessages as Parameters<typeof setMessages>[0])
      })
      .catch(() => { /* thread doesn't exist yet — that's fine */ })
    return () => controller.abort()
  }, [activeThreadId, setMessages])

  // Auto-title from first user message + refresh thread list after response completes
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const wasActive = prevStatusRef.current === "streaming" || prevStatusRef.current === "submitted"
    const isNowReady = status === "ready"
    prevStatusRef.current = status
    if (wasActive && isNowReady) {
      // Response completed — refresh conversation list from server
      refreshConversations()
    }
    if (status === "streaming" || status === "submitted") return
    if (messages.length === 0) return
    const firstUser = messages.find((m) => m.role === "user")
    if (!firstUser) return
    const text = firstUser.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("")
      .slice(0, 60)
    if (!text) return
    ensureConversation(activeThreadId, text)
    updateTitle(activeThreadId, text)
  }, [messages, activeThreadId, status, updateTitle, ensureConversation, refreshConversations])

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
  const [cardStates, setCardStates] = useState<Record<string, {
    state: "submitting" | "confirmed" | "error"
    errorMessage?: string
  }>>({})

  useEffect(() => {
    saveDraft(input, attachments)
  }, [input, attachments])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isLoading = status === "submitted" || status === "streaming"

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
    }
  }, [input])

  // ---- File handling ----
  const addFile = useCallback(
    (file: File) => {
      setFileError(null)
      const ext = "." + file.name.split(".").pop()?.toLowerCase()
      if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.includes(ext)) {
        setFileError(`Unsupported file type: ${file.name}`)
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 10MB)`)
        return
      }
      const totalSize = attachments.reduce((sum, a) => sum + a.file.size, 0) + file.size
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

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) addFile(file)
          return
        }
      }
      const pastedText = e.clipboardData.getData("text/plain")
      if (pastedText && pastedText.length >= LARGE_PASTE_THRESHOLD) {
        e.preventDefault()
        const blob = new Blob([pastedText], { type: "text/plain" })
        const lines = pastedText.split("\n").length
        const fileName = `pasted-text-${lines}-lines.txt`
        const file = new File([blob], fileName, { type: "text/plain" })
        setAttachments((prev) => [...prev, { file, pastedText }])
      }
    },
    [addFile],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files) Array.from(files).forEach(addFile)
      e.target.value = ""
    },
    [addFile],
  )

  const expandFile = useCallback((attachment: Attachment) => {
    if (attachment.preview) {
      setExpandedFile({ type: "image", url: attachment.preview, name: attachment.file.name })
      return
    }
    const ext = attachment.file.name.split(".").pop()?.toLowerCase()
    const textExts = ["md", "txt", "log", "json", "ts", "tsx", "js", "csv"]
    if (attachment.pastedText) {
      setExpandedFile({ type: "text", content: attachment.pastedText, name: "Pasted text" })
    } else if (textExts.includes(ext || "")) {
      attachment.file.text().then((content) => {
        setExpandedFile({ type: "text", content, name: attachment.file.name })
      })
    } else {
      setExpandedFile({
        type: "text",
        content: `File: ${attachment.file.name}\nType: ${attachment.file.type || ext}\nSize: ${(attachment.file.size / 1024).toFixed(1)} KB\n\nPreview not available for this file type.`,
        name: attachment.file.name,
      })
    }
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const removed = prev[index]
      if (removed.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  // ---- Submit ----
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!input.trim() && attachments.length === 0) return
      if (isLoading) return
      setFileError(null)

      const files = attachments.map((a) => a.file)
      const fileList = files.length > 0
        ? (() => { const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); return dt.files })()
        : undefined

      sendMessage({ text: input.trim(), ...(fileList ? { files: fileList } : {}) })
      setInput("")
      setAttachments([])
      clearDraft()
    },
    [input, attachments, isLoading, sendMessage],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit(e as unknown as React.FormEvent)
      }
    },
    [handleSubmit],
  )

  // ---- Ticket actions ----
  // When user clicks "Create Ticket" on the triage card, send a message
  // to the agent so it creates the Linear issue with full context.
  const handleCreateTicket = (_triageData: Record<string, unknown>, cardKey: string) => {
    setCardStates((prev) => ({ ...prev, [cardKey]: { state: "confirmed" } }))
    sendMessage({ text: "Confirmed. Create the Linear ticket with the details above." })
  }

  const handleUpdateExisting = (dupData: Record<string, unknown>) => {
    sendMessage({ text: `Update the existing ticket: ${dupData.existingTicketTitle ?? ""}` })
  }

  const handleCreateNew = (_dupData: Record<string, unknown>) => {
    sendMessage({ text: "Ignore the duplicate, create a new ticket with the triage details above." })
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex h-full flex-col">
      {/* Messages area — scrollable, centered */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages ? (
          /* Empty state — centered welcome */
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-heading font-bold text-lg shadow-neu-sm">
                T
              </div>
              <h1 className="font-heading text-2xl font-bold mb-2">
                How can I help?
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Describe an incident, paste a screenshot, or ask about your stack.
              </p>
            </div>
          </div>
        ) : (
          /* Message feed — centered container */
          <div className="mx-auto w-full max-w-[800px] px-4 py-6 space-y-6">
            {messages.map((message) => (
              <div key={message.id}>
                {message.role === "user" ? (
                  /* ── User message — right-aligned bubble ── */
                  <div className="flex justify-end">
                    <div className="max-w-[70%] w-fit rounded-2xl bg-primary/10 px-4 py-3 text-sm">
                      {/* File attachments in user message */}
                      {(() => {
                        const fileParts = message.parts.filter((p) => p.type === "file") as Array<{
                          type: "file"; mediaType: string; url: string; filename?: string
                        }>
                        if (fileParts.length === 0) return null
                        return (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {fileParts.map((file, i) =>
                              file.mediaType.startsWith("image/") ? (
                                <img key={`file-${i}`} src={file.url} alt={file.filename || "Attached image"}
                                  className="max-h-48 max-w-full rounded-lg object-cover border border-border/50" />
                              ) : (
                                <div key={`file-${i}`} className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2">
                                  <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground truncate max-w-40">{file.filename || file.mediaType}</span>
                                </div>
                              ),
                            )}
                          </div>
                        )
                      })()}
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {message.parts
                          .filter((p): p is { type: "text"; text: string } => p.type === "text")
                          .map((p) => p.text)
                          .join("")}
                      </p>
                    </div>
                  </div>
                ) : (
                  /* ── Assistant message — avatar + transparent content ── */
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-heading text-xs font-bold">
                      T
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      {(() => {
                        const textContent = message.parts
                          .filter((p): p is { type: "text"; text: string } => p.type === "text")
                          .map((p) => p.text)
                          .join("")

                        const reasoningContent = message.parts
                          .filter((p): p is { type: "reasoning"; text: string } => p.type === "reasoning")
                          .map((p) => p.text)
                          .join("")

                        const fileParts = message.parts.filter((p) => p.type === "file") as Array<{
                          type: "file"; mediaType: string; url: string; filename?: string
                        }>
                        const toolParts = message.parts.filter((p) => p.type.startsWith("tool-"))

                        return (
                          <>
                            {/* File attachments */}
                            {fileParts.length > 0 && (
                              <div className="flex flex-wrap gap-2 mb-3">
                                {fileParts.map((file, i) =>
                                  file.mediaType.startsWith("image/") ? (
                                    <img key={`file-${i}`} src={file.url} alt={file.filename || "Image"}
                                      className="max-h-48 max-w-full rounded-lg object-cover border border-border/50" />
                                  ) : (
                                    <div key={`file-${i}`} className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2">
                                      <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                      <span className="text-xs text-muted-foreground truncate max-w-40">{file.filename || file.mediaType}</span>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}

                            {/* Reasoning / Chain of Thought */}
                            {reasoningContent && (
                              <ReasoningBlock
                                content={reasoningContent}
                                isStreaming={status === "streaming" && message === messages[messages.length - 1]}
                              />
                            )}

                            {/* Text content — rendered as markdown, no box */}
                            {textContent && (
                              <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-p:leading-relaxed prose-headings:my-3 prose-headings:font-heading prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-3 prose-code:text-primary prose-code:bg-muted/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/50 prose-pre:rounded-xl prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground prose-blockquote:border-primary/30 prose-blockquote:text-muted-foreground prose-hr:border-border">
                                <Markdown remarkPlugins={[remarkGfm]}>{textContent}</Markdown>
                              </div>
                            )}

                            {/* Tool outputs */}
                            {toolParts.map((part, i) => {
                              const toolPart = part as any
                              const toolKey = part.type.replace("tool-", "")
                              const ToolComponent = toolComponents[toolKey]

                              if (toolKey === "displayTriageTool" && toolPart.state === "output-available") {
                                const output = toolPart.output as Record<string, unknown>
                                const cardKey = `${message.id}-${i}`
                                const override = cardStates[cardKey]
                                const cardState = override?.state === "confirmed" ? "confirmed"
                                  : override?.state === "error" ? "error"
                                  : (output.state as import("@/components/triage-card").TriageCardState) ?? "pending"
                                return (
                                  <div key={`tool-${i}`} className="mt-3">
                                    <TriageCard
                                      {...(output as unknown as import("@/components/triage-card").TriageCardProps)}
                                      state={cardState}
                                      isSubmitting={override?.state === "submitting"}
                                      errorMessage={override?.errorMessage ?? output.errorMessage as string | undefined}
                                      onCreateTicket={() => handleCreateTicket(output, cardKey)}
                                      onRetry={() => handleCreateTicket(output, cardKey)}
                                    />
                                  </div>
                                )
                              }

                              if (toolKey === "displayDuplicateTool" && toolPart.state === "output-available") {
                                const output = toolPart.output as Record<string, unknown>
                                return (
                                  <div key={`tool-${i}`} className="mt-3">
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
                                  return <div key={`tool-${i}`} className="mt-3"><ToolComponent {...(toolPart.output ?? {})} /></div>
                                }
                                if (toolPart.state === "output-error") {
                                  return <div key={`tool-${i}`} className="mt-3"><ToolComponent state="error" errorMessage={toolPart.errorText ?? "Tool execution failed"} /></div>
                                }
                                return <div key={`tool-${i}`} className="mt-3"><ToolComponent state="loading" /></div>
                              }

                              // Generic tool step indicator
                              const stepLabel = toolKey.replace(/-/g, " ")
                              if (toolPart.state === "output-available") {
                                return (
                                  <div key={`tool-${i}`} className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                                    <span>{stepLabel}</span>
                                  </div>
                                )
                              }
                              if (toolPart.state === "output-error") {
                                return (
                                  <div key={`tool-${i}`} className="flex items-center gap-2 mt-2 text-xs text-destructive">
                                    <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                                    <span>{stepLabel} failed</span>
                                  </div>
                                )
                              }
                              return (
                                <div key={`tool-${i}`} className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                                  <span>{stepLabel}...</span>
                                </div>
                              )
                            })}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Loading — thinking dots with avatar */}
            {status === "submitted" && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-heading text-xs font-bold">
                  T
                </div>
                <div className="flex items-center gap-1.5 pt-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground font-heading text-xs font-bold">
                  !
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-destructive mb-2">{error.message || "Something went wrong"}</p>
                  <Button size="sm" variant="destructive" onClick={() => regenerate()}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setExpandedFile(null)}>
          <button onClick={() => setExpandedFile(null)}
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10">
            <X className="h-5 w-5" />
          </button>
          {expandedFile.type === "image" && expandedFile.url && (
            <img src={expandedFile.url} alt={expandedFile.name}
              className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          )}
          {expandedFile.type === "text" && expandedFile.content && (
            <div className="max-h-[85vh] max-w-[90vw] w-full sm:w-[700px] rounded-xl bg-card shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <AttachmentIcon fileName={expandedFile.name} />
                  <span className="text-sm font-medium text-foreground">{expandedFile.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">{expandedFile.content.split("\n").length} lines</span>
              </div>
              <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap">
                {expandedFile.content}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Composer — fixed at bottom, pill-shaped ── */}
      <div className="px-4 pb-4 pt-2">
        <div className="mx-auto max-w-[800px]">
          {/* File error */}
          {fileError && <div className="mb-2 text-xs text-destructive">{fileError}</div>}

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment, i) => (
                <div key={i} className="group relative">
                  {attachment.preview ? (
                    <button type="button" onClick={() => expandFile(attachment)}
                      className="relative cursor-zoom-in rounded-xl bg-muted/80 border border-border overflow-hidden h-14 w-14">
                      <img src={attachment.preview} alt={attachment.file.name} className="h-full w-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                        <ZoomIn className="h-4 w-4 text-white" />
                      </span>
                    </button>
                  ) : attachment.pastedText ? (
                    <button type="button" onClick={() => expandFile(attachment)}
                      className="flex items-center gap-2.5 rounded-xl bg-muted/80 border border-border px-3 h-14 max-w-56 cursor-pointer hover:bg-muted transition-colors text-left">
                      <FileText className="h-5 w-5 shrink-0 text-secondary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">Pasted text</p>
                        <p className="text-[10px] text-muted-foreground">{attachment.pastedText.split("\n").length} lines</p>
                      </div>
                    </button>
                  ) : (
                    <button type="button" onClick={() => expandFile(attachment)}
                      className="flex items-center gap-2.5 rounded-xl bg-muted/80 border border-border px-3 h-14 max-w-56 cursor-pointer hover:bg-muted transition-colors text-left">
                      <AttachmentIcon fileName={attachment.file.name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{attachment.file.name}</p>
                        <p className="text-[10px] text-muted-foreground">{(attachment.file.size / 1024).toFixed(1)}KB</p>
                      </div>
                    </button>
                  )}
                  <button onClick={() => removeAttachment(i)}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input — pill-shaped with shadow */}
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-2 rounded-2xl bg-card px-4 py-3 shadow-lg ring-1 ring-border/50">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                title="Attach files">
                <Paperclip className="h-4 w-4" />
              </button>
              <input ref={fileInputRef} type="file" multiple
                accept={[...ACCEPTED_TYPES, ".md", ".log", ".pdf", ".docx"].join(",")}
                onChange={handleFileSelect} className="hidden" />

              <textarea ref={textareaRef} value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePaste} onKeyDown={handleKeyDown}
                placeholder="Describe an incident..."
                className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none max-h-40 leading-relaxed"
                rows={1} disabled={isLoading} />

              <Button type="submit" size="icon" className="h-8 w-8 shrink-0 rounded-lg"
                disabled={isLoading || (!input.trim() && attachments.length === 0)}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/** Collapsible reasoning/chain-of-thought block */
function ReasoningBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-3">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Brain className="h-3.5 w-3.5 text-purple-400" />
        <span>{isStreaming ? "Thinking..." : "Thought process"}</span>
        {isStreaming && <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />}
        {!isStreaming && <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && !isStreaming && (
        <div className="mt-1.5 pl-5 text-xs text-muted-foreground/80 leading-relaxed border-l-2 border-purple-400/30 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  )
}

/** Icon picker for document attachments */
function AttachmentIcon({ fileName }: { fileName: string }) {
  const ext = fileName.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "md": case "txt": case "log":
      return <FileText className="h-4 w-4 shrink-0 text-secondary" />
    case "json": case "ts": case "tsx": case "js":
      return <FileCode className="h-4 w-4 shrink-0 text-orange" />
    case "pdf":
      return <FileText className="h-4 w-4 shrink-0 text-coral" />
    case "docx": case "doc":
      return <FileText className="h-4 w-4 shrink-0 text-steel-blue" />
    default:
      return <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
  }
}
