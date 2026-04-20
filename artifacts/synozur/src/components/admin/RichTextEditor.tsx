import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export interface RichTextEditorChange {
  html: string;
  markdown: string;
}

interface Props {
  value: string;
  onChange: (change: RichTextEditorChange) => void;
  onUploadImage: () => Promise<string | null>;
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

export function RichTextEditor({ value, onChange, onUploadImage, placeholder }: Props) {
  const lastValueRef = useRef(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: "bg-muted p-3 rounded text-sm" } },
      }),
      Image.configure({ inline: false, HTMLAttributes: { class: "rounded-md max-w-full" } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: "underline text-primary" } }),
      Table.configure({ resizable: false, HTMLAttributes: { class: "border-collapse w-full" } }),
      TableRow,
      TableHeader.configure({ HTMLAttributes: { class: "border border-border bg-muted px-2 py-1 text-left" } }),
      TableCell.configure({ HTMLAttributes: { class: "border border-border px-2 py-1" } }),
      Typography,
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none min-h-[400px] px-4 py-3 focus:outline-none",
        "data-testid": "post-editor-content",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastValueRef.current = html;
      const markdown = turndown.turndown(html);
      onChange({ html, markdown });
    },
  });

  // Sync external value changes only when editor content differs.
  useEffect(() => {
    if (!editor) return;
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div className="border border-border rounded-md min-h-[450px] bg-card" />
    );
  }

  return (
    <div className="border border-border rounded-md bg-card">
      <Toolbar editor={editor} onUploadImage={onUploadImage} />
      <div className="border-t border-border">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({
  editor,
  onUploadImage,
}: {
  editor: Editor;
  onUploadImage: () => Promise<string | null>;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const insertLink = () => {
    const prev = editor.getAttributes("link").href ?? "";
    setLinkUrl(prev);
    setLinkOpen(true);
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
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
          const url = await onUploadImage();
          if (url) editor.chain().focus().setImage({ src: url }).run();
        }}
        label="Insert image"
        testId="rt-image"
      >
        <ImageIcon className="h-4 w-4" />
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
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: linkUrl })
                  .run();
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
    </div>
  );
}
