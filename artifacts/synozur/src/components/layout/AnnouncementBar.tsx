import { useState, useEffect } from "react";
import { X } from "lucide-react";

interface Props {
  text: string;
  linkText?: string | null;
  linkUrl?: string | null;
}

const STORAGE_KEY = "synozur_announcement_dismissed";

function isSafeUrl(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function readDismissed(text: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const { text: storedText } = JSON.parse(stored) as { text: string };
      return storedText === text;
    }
  } catch {
    // ignore corrupt storage
  }
  return false;
}

export function AnnouncementBar({ text, linkText, linkUrl }: Props) {
  const [dismissed, setDismissed] = useState(() => readDismissed(text));

  // Re-evaluate when the text prop changes (admin updated the message).
  useEffect(() => {
    setDismissed(readDismissed(text));
  }, [text]);

  if (dismissed) return null;

  const safeUrl = linkUrl && isSafeUrl(linkUrl) ? linkUrl : null;
  const showLink = linkText && safeUrl;

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ text }));
    } catch {
      // ignore storage errors
    }
    setDismissed(true);
  }

  return (
    <div
      role="banner"
      className="relative z-50 w-full bg-primary text-primary-foreground text-sm py-2 px-4"
    >
      <div className="container mx-auto flex items-center justify-center gap-2 pr-8">
        <span>{text}</span>
        {showLink && (
          <a
            href={safeUrl}
            className="underline underline-offset-2 font-semibold hover:opacity-80 transition-opacity whitespace-nowrap"
          >
            {linkText}
          </a>
        )}
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-primary-foreground/20 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
