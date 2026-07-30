import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Typography } from "@tiptap/extension-typography";
import TurndownService from "turndown";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Code,
  Code2,
  Table as TableIcon,
  Undo,
  Redo,
  Braces,
  AlertTriangle,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MediaPickerModal, mediaUrl } from "@/components/admin/MediaPickerModal";
import type { MediaItem } from "@workspace/api-client-react";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

// ---------------------------------------------------------------------------
// Custom TipTap Iframe Node
// ---------------------------------------------------------------------------

const IFRAME_ATTRS = ["src", "width", "height", "frameborder", "allow",
  "allowfullscreen", "scrolling", "style", "title", "loading"] as const;

const IframeExtension = Node.create({
  name: "iframe",
  group: "block",
  atom: true,

  addAttributes() {
    return Object.fromEntries(
      IFRAME_ATTRS.map((a) => [a, { default: null }])
    );
  },

  parseHTML() {
    return [{ tag: "iframe" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["iframe", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ({ node }) => {
      const wrapper = document.createElement("div");
      wrapper.className =
        "relative my-3 rounded overflow-hidden border border-border bg-muted/30";

      const label = document.createElement("div");
      label.className =
        "absolute top-0 left-0 text-[10px] text-muted-foreground bg-muted/80 px-2 py-0.5 rounded-br pointer-events-none z-10";
      label.textContent = "Embed";

      const iframe = document.createElement("iframe");
      iframe.className = "w-full block";
      iframe.style.border = "0";
      for (const [k, v] of Object.entries(node.attrs)) {
        if (v != null && k !== "style") iframe.setAttribute(k, String(v));
      }
      if (!iframe.getAttribute("height")) iframe.setAttribute("height", "200");

      wrapper.appendChild(label);
      wrapper.appendChild(iframe);
      return { dom: wrapper };
    };
  },
});

// ---------------------------------------------------------------------------
// Custom Image extension with size + alignment attributes
// ---------------------------------------------------------------------------

const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-size": {
        default: "full",
        parseHTML: (element) => element.getAttribute("data-size") ?? "full",
        renderHTML: (attributes) => ({
          "data-size": (attributes["data-size"] as string | undefined) ?? "full",
        }),
      },
      "data-align": {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-align") ?? "center",
        renderHTML: (attributes) => ({
          "data-align": (attributes["data-align"] as string | undefined) ?? "center",
        }),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Embed code parser
// ---------------------------------------------------------------------------

/**
 * Attempt to derive an iframe src from a script-based embed snippet.
 *
 * Many podcast/audio platforms now provide a `<script src="...">` + `<div>` embed
 * instead of a plain `<iframe>`. Where we know the pattern, we convert it to a
 * stable iframe URL. Returns null when no known pattern is recognised.
 */
function scriptEmbedToIframeSrc(doc: Document): string | null {
  const script = doc.querySelector("script[src]");
  if (!script) return null;
  const src = script.getAttribute("src") ?? "";

  // Buzzsprout:
  //   <script src='https://www.buzzsprout.com/{showId}/episodes/{epId}-{slug}.js?...'>
  //   → https://www.buzzsprout.com/{showId}/embed/{epId}
  const buzzsprout = src.match(
    /^https:\/\/www\.buzzsprout\.com\/(\d+)\/episodes\/(\d+)[^?]*/,
  );
  if (buzzsprout) {
    return `https://www.buzzsprout.com/${buzzsprout[1]}/embed/${buzzsprout[2]}`;
  }

  // Libsyn (podbean-hosted player fallback):
  //   <script src='https://www.podbean.com/player-v2/...'>
  const podbean = src.match(/^https:\/\/(www\.podbean\.com)\//);
  if (podbean) {
    // Podbean scripts load their own iframe; return the script src so the
    // caller can use it as-is after stripping the .js / query suffix.
    return src;
  }

  return null;
}

function parseEmbedCode(raw: string): Record<string, string | null> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const doc = new DOMParser().parseFromString(trimmed, "text/html");

  // --- Path 1: direct <iframe> embed (most platforms) ---
  const iframe = doc.querySelector("iframe");
  if (iframe) {
    const attrs: Record<string, string | null> = {};
    for (const attr of Array.from(iframe.attributes)) {
      attrs[attr.name] = attr.value;
    }
    // Normalize protocol-relative src (//host/path → https://host/path).
    if (attrs.src?.startsWith("//")) {
      attrs.src = `https:${attrs.src}`;
    }
    return attrs.src ? attrs : null;
  }

  // --- Path 2: script-based embed (Buzzsprout, etc.) ---
  const iframeSrc = scriptEmbedToIframeSrc(doc);
  if (iframeSrc) {
    return { src: iframeSrc, width: "100%", height: "200", frameborder: "0" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Heading-order lint (#142 Phase A)
//
// Surfaces a soft warning when the editor's document skips a heading
// level (e.g. an H2 followed by an H4 with no H3 between). This is a
// guidance-only signal, not a publish gate — Phase D will introduce the
// hard gate once editors have a chance to clean their backlog.
// ---------------------------------------------------------------------------

interface HeadingIssue {
  message: string;
  /** 1-based heading occurrence index, used as a stable React key. */
  occurrence: number;
}

function findHeadingSkips(editor: Editor): HeadingIssue[] {
  const issues: HeadingIssue[] = [];
  const headings: { level: number; text: string }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading") {
      const level = Number(node.attrs.level ?? 0);
      if (level > 0) {
        headings.push({ level, text: node.textContent });
      }
    }
  });

  // Track the deepest level that has been seen so far. A heading at level N
  // is a "skip" when N - lastLevel > 1, i.e. it dives more than one level
  // below the previous heading without an intermediate level.
  let lastLevel = 0;
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    if (lastLevel > 0 && h.level > lastLevel + 1) {
      issues.push({
        message: `H${h.level} "${truncate(h.text || "Untitled", 40)}" follows H${lastLevel} — add an intermediate H${lastLevel + 1} or downgrade the heading.`,
        occurrence: i + 1,
      });
    }
    lastLevel = h.level;
  }
  return issues;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// ---------------------------------------------------------------------------
// RichTextEditor public API
// ---------------------------------------------------------------------------

export interface RichTextEditorChange {
  html: string;
  markdown: string;
}

interface Props {
  value: string;
  onChange: (change: RichTextEditorChange) => void;
  /** @deprecated The editor now handles image insertion internally via the media picker. */
  onUploadImage?: () => Promise<string | null>;
  placeholder?: string;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  testId,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      data-testid={testId}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover-elevate",
        active && "text-foreground bg-muted",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ value, onChange, placeholder: _placeholder }: Props) {
  const lastValueRef = useRef(value);
  // Heading-order issues are recomputed on every editor update — bumping
  // this counter tells the memo below to re-walk the doc.
  const [docVersion, setDocVersion] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Resolve callback stored so the toolbar can await the user's selection
  const resolvePickerRef = useRef<((url: string | null) => void) | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: "bg-muted p-3 rounded text-sm" } },
      }),
      CustomImage.configure({ inline: false, HTMLAttributes: { class: "rounded-md max-w-full" } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: "underline text-primary" } }),
      Table.configure({ resizable: false, HTMLAttributes: { class: "border-collapse w-full" } }),
      TableRow,
      TableHeader.configure({ HTMLAttributes: { class: "border border-border bg-muted px-2 py-1 text-left" } }),
      TableCell.configure({ HTMLAttributes: { class: "border border-border px-2 py-1" } }),
      Typography,
      IframeExtension,
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class:
          "prose dark:prose-invert max-w-none min-h-[400px] px-4 py-3 focus:outline-none",
        "data-testid": "post-editor-content",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastValueRef.current = html;
      const markdown = turndown.turndown(html);
      onChange({ html, markdown });
      setDocVersion((v) => v + 1);
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      editor.commands.setContent(value || "", { emitUpdate: false });
      setDocVersion((v) => v + 1);
    }
  }, [value, editor]);

  // Heading-order lint runs against the current editor doc. This is a
  // soft signal only — we surface it inline and never block the save.
  const headingIssues = useMemo(
    () => (editor ? findHeadingSkips(editor) : []),
    // `docVersion` is the trigger; `editor` identity stays stable across
    // updates so it isn't a meaningful dep on its own.
    [editor, docVersion],
  );

  /** Opens the media picker and resolves with the chosen URL (or null). */
  const openImagePicker = (): Promise<string | null> => {
    return new Promise((resolve) => {
      resolvePickerRef.current = resolve;
      setPickerOpen(true);
    });
  };

  const handlePickerSelect = (m: MediaItem) => {
    const url = mediaUrl(m);
    resolvePickerRef.current?.(url);
    resolvePickerRef.current = null;
    setPickerOpen(false);
  };

  const handlePickerClose = () => {
    resolvePickerRef.current?.(null);
    resolvePickerRef.current = null;
    setPickerOpen(false);
  };

  if (!editor) {
    return (
      <div className="border border-border rounded-md min-h-[450px] bg-card" />
    );
  }

  return (
    <div className="border border-border rounded-md bg-card">
      <ImageFloatingToolbar editor={editor} />
      <Toolbar editor={editor} onOpenImagePicker={openImagePicker} />
      {headingIssues.length > 0 && (
        <HeadingOrderWarnings issues={headingIssues} />
      )}
      <div className="border-t border-border">
        <EditorContent editor={editor} />
      </div>
      <MediaPickerModal
        open={pickerOpen}
        onClose={handlePickerClose}
        onSelect={handlePickerSelect}
        title="Insert image"
        kind="image"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating image toolbar (appears when an image node is selected)
// ---------------------------------------------------------------------------

const IMAGE_SIZES = [
  { value: "small",  label: "S",    title: "Small (33%)" },
  { value: "medium", label: "M",    title: "Medium (50%)" },
  { value: "full",   label: "Full", title: "Full width" },
] as const;

const IMAGE_ALIGNS = [
  { value: "left",   Icon: AlignLeft,   title: "Float left" },
  { value: "center", Icon: AlignCenter, title: "Center" },
  { value: "right",  Icon: AlignRight,  title: "Float right" },
] as const;

function ImageFloatingToolbar({ editor }: { editor: Editor }) {
  const activeSize  = (editor.getAttributes("image")["data-size"]  as string | undefined) ?? "full";
  const activeAlign = (editor.getAttributes("image")["data-align"] as string | undefined) ?? "center";

  // Merge rapid consecutive attribute clicks into a single undo step.
  //
  // Strategy: the FIRST click for a given (attribute key, image position) pair
  // is applied normally and creates one history entry. Every subsequent click
  // within a 600 ms window applies the change with `addToHistory: false`,
  // keeping the visual state current without stacking extra undo entries.
  //
  // Keying on image position means switching to a different image always
  // starts a fresh window, so cross-image cross-contamination is impossible.
  //
  // Size and alignment are tracked separately (different keys) so a size click
  // then an align click each get their own undo step — only rapid clicks of
  // the *same* attribute on the *same* image are merged.
  const debounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const windowStartRef = useRef<Record<string, number>>({});

  // Clear any pending debounce timers when the toolbar unmounts so we don't
  // leave stray callbacks that could fire against an already-destroyed editor.
  useEffect(() => {
    const timers = debounceTimersRef.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  const applyImageAttr = (key: string, value: string) => {
    const { from } = editor.state.selection;
    const windowKey = `${key}:${from}`;
    const isFirstInWindow = !(windowKey in windowStartRef.current);

    if (isFirstInWindow) {
      editor.chain().focus().updateAttributes("image", { [key]: value }).run();
      windowStartRef.current[windowKey] = from;
    } else {
      // Apply visually without recording a new history entry so that a single
      // Ctrl+Z undoes the entire burst back to the state before the first click.
      editor
        .chain()
        .focus()
        .setMeta("addToHistory", false)
        .updateAttributes("image", { [key]: value })
        .run();
    }

    if (debounceTimersRef.current[windowKey]) {
      clearTimeout(debounceTimersRef.current[windowKey]);
    }
    debounceTimersRef.current[windowKey] = setTimeout(() => {
      delete windowStartRef.current[windowKey];
      delete debounceTimersRef.current[windowKey];
    }, 600);
  };

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e }: { editor: Editor; element: HTMLElement; view: unknown; state: unknown; oldState?: unknown; from: number; to: number }) => e.isActive("image")}
    >
      <div className="flex items-center gap-0.5 rounded-md border border-border bg-card shadow-md px-1 py-1">
        {/* Size group */}
        <span className="text-[10px] text-muted-foreground px-1 select-none">Size</span>
        {IMAGE_SIZES.map(({ value, label, title }) => (
          <button
            key={value}
            type="button"
            title={title}
            aria-label={title}
            onMouseDown={(e) => {
              e.preventDefault();
              applyImageAttr("data-size", value);
            }}
            className={cn(
              "h-7 min-w-[2rem] px-1.5 inline-flex items-center justify-center rounded text-xs font-medium",
              activeSize === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
        <div className="w-px h-5 bg-border mx-1" />
        {/* Alignment group */}
        <span className="text-[10px] text-muted-foreground px-1 select-none">Align</span>
        {IMAGE_ALIGNS.map(({ value, Icon, title }) => (
          <button
            key={value}
            type="button"
            title={title}
            aria-label={title}
            onMouseDown={(e) => {
              e.preventDefault();
              applyImageAttr("data-align", value);
            }}
            className={cn(
              "h-7 w-7 inline-flex items-center justify-center rounded",
              activeAlign === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </BubbleMenu>
  );
}

function HeadingOrderWarnings({ issues }: { issues: HeadingIssue[] }) {
  return (
    <div
      className="border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
      data-testid="heading-order-warnings"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium">
            Heading order skips a level
            {issues.length > 1 ? ` (${issues.length} issues)` : ""}
          </div>
          <ul className="mt-1 space-y-0.5">
            {issues.slice(0, 3).map((i) => (
              <li key={i.occurrence}>· {i.message}</li>
            ))}
            {issues.length > 3 && (
              <li className="text-amber-200/70">
                · …and {issues.length - 3} more
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({
  editor,
  onOpenImagePicker,
}: {
  editor: Editor;
  onOpenImagePicker: () => Promise<string | null>;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedCode, setEmbedCode] = useState("");
  const [embedError, setEmbedError] = useState("");

  const insertLink = () => {
    const prev = editor.getAttributes("link").href ?? "";
    setLinkUrl(prev);
    setLinkOpen(true);
    setEmbedOpen(false);
  };

  const openEmbed = () => {
    setEmbedCode("");
    setEmbedError("");
    setEmbedOpen(true);
    setLinkOpen(false);
  };

  const applyEmbed = () => {
    const attrs = parseEmbedCode(embedCode);
    if (!attrs || !attrs.src) {
      setEmbedError(
        "Couldn't find an embeddable player URL. Paste an <iframe> embed code, or for script-based players (Buzzsprout, etc.) use the platform's direct embed/share URL instead.",
      );
      return;
    }
    editor.chain().focus().insertContent({ type: "iframe", attrs }).run();
    setEmbedOpen(false);
    setEmbedCode("");
    setEmbedError("");
  };

  return (
    <div className="sticky top-12 z-20 flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-card border-b border-border rounded-t-md">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        label="Bold"
        testId="rt-bold"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        label="Italic"
        testId="rt-italic"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <div className="w-px h-5 bg-border mx-1" />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        label="Heading 1"
        testId="rt-h1"
      >
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        label="Heading 2"
        testId="rt-h2"
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        label="Heading 3"
        testId="rt-h3"
      >
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>
      <div className="w-px h-5 bg-border mx-1" />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        label="Bullet list"
        testId="rt-ul"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        label="Ordered list"
        testId="rt-ol"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        label="Quote"
        testId="rt-quote"
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <div className="w-px h-5 bg-border mx-1" />
      <ToolbarButton
        onClick={insertLink}
        active={editor.isActive("link")}
        label="Insert link"
        testId="rt-link"
      >
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={async () => {
          const url = await onOpenImagePicker();
          if (!url) return;
          // Defer one macrotask so the Radix Dialog fully releases its
          // focus-trap before we try to re-focus the editor. Without this,
          // editor.chain().focus() fires while the trap is still active and
          // setImage() silently returns false (no insert, no error).
          await new Promise<void>((r) => setTimeout(r, 0));
          const inserted = editor.chain().focus().setImage({ src: url }).run();
          if (!inserted) {
            // Fallback: cursor may be in a context that blocks block-level
            // nodes (e.g. inside a code block). Jump to the end and retry.
            editor.chain().focus("end").setImage({ src: url }).run();
          }
        }}
        label="Insert image"
        testId="rt-image"
      >
        <ImageIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={openEmbed}
        active={embedOpen}
        label="Insert embed (podcast player, video, etc.)"
        testId="rt-embed"
      >
        <Braces className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        label="Inline code"
        testId="rt-code"
      >
        <Code className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        label="Code block"
        testId="rt-codeblock"
      >
        <Code2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
        label="Insert table"
        testId="rt-table"
      >
        <TableIcon className="h-4 w-4" />
      </ToolbarButton>
      <div className="ml-auto flex items-center">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          label="Undo"
          testId="rt-undo"
        >
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          label="Redo"
          testId="rt-redo"
        >
          <Redo className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {/* Link panel */}
      {linkOpen && (
        <div className="basis-full mt-2 flex items-center gap-2">
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm"
            data-testid="input-link-url"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (linkUrl) {
                editor.chain().focus().extendMarkRange("link").setLink({ href: linkUrl }).run();
              } else {
                editor.chain().focus().unsetLink().run();
              }
              setLinkOpen(false);
            }}
            data-testid="button-link-apply"
          >
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              editor.chain().focus().unsetLink().run();
              setLinkOpen(false);
            }}
          >
            Remove
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen(false)}>
            Cancel
          </Button>
        </div>
      )}

      {/* Embed panel */}
      {embedOpen && (
        <div className="basis-full mt-2 flex flex-col gap-2" data-testid="embed-panel">
          <p className="text-xs text-muted-foreground">
            Paste the full <code className="bg-muted px-1 rounded">&lt;iframe&gt;</code> embed code from
            Buzzsprout, Spotify, Apple Podcasts, YouTube, Vimeo, SoundCloud, etc.
          </p>
          <textarea
            value={embedCode}
            onChange={(e) => { setEmbedCode(e.target.value); setEmbedError(""); }}
            placeholder={'<iframe src="https://www.buzzsprout.com/..." ...></iframe>'}
            rows={3}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm font-mono resize-none"
            data-testid="input-embed-code"
          />
          {embedError && (
            <p className="text-xs text-destructive">{embedError}</p>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={applyEmbed} data-testid="button-embed-apply">
              Insert embed
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { setEmbedOpen(false); setEmbedCode(""); setEmbedError(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
