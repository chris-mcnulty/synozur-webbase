import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/auth";
import { useToast } from "@/hooks/use-toast";
import type { AvatarUploadResult } from "@workspace/api-zod/types";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export default function AdminProfile() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function uploadAvatar(file: File) {
    if (file.size > 5 * 1024 * 1024 || file.size === 0) {
      setUploadMessage("Choose a photo that is between 1 byte and 5 MB.");
      return;
    }
    setUploading(true);
    setUploadMessage("Uploading photo to Microsoft SharePoint Embedded…");
    try {
      const res = await fetch(`${BASE_PATH}/api/cms/profile/avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        credentials: "include",
        body: file,
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error ?? (res.status === 413 ? "Photo must be 5 MB or smaller." : "Photo upload failed. Please try again."));
      }
      const result: AvatarUploadResult = await res.json();
      setAvatarUrl(result.avatarUrl);
      setUploadMessage("Photo uploaded. Click Save profile to apply it.");
    } catch (err) {
      setUploadMessage(err instanceof Error ? err.message : "Photo upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? "");
      setBio(user.bio ?? "");
      setAvatarUrl(user.avatarUrl ?? "");
    }
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (uploading || saving) return;
    setSaving(true);
    try {
      const body: Record<string, string | null> = {
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        bio: bio.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
      };
      const res = await fetch(`${BASE_PATH}/api/cms/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? res.statusText);
      }
      await refresh();
      toast({ title: "Profile saved" });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const avatarPreview = avatarUrl.trim();

  return (
    <AdminLayout
      title="My Profile"
      crumbs={[{ label: "Admin", href: "/" }, { label: "My Profile" }]}
    >
      <div className="max-w-xl">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="flex items-center gap-4">
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt={displayName || "Avatar"}
                className="w-16 h-16 rounded-full object-cover border border-border/60"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-2xl text-muted-foreground font-bold">
                {(displayName || user?.email || "?")[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold truncate">{user?.displayName ?? user?.email}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name"
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground">
              Shown as the author name on blog posts and the OG image.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="avatar-file">Profile photo</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                ref={fileInput}
                id="avatar-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={uploading || saving}
                onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAvatar(file); }}
              />
              <Button type="button" variant="outline" disabled={uploading || saving} onClick={() => fileInput.current?.click()} data-testid="button-upload-avatar">
                {uploading ? "Uploading…" : "Upload photo"}
              </Button>
              {avatarUrl && <Button type="button" variant="ghost" disabled={uploading || saving} onClick={() => { setAvatarUrl(""); setUploadMessage("Photo removed from this form. Click Save profile to apply."); }}>Remove photo</Button>}
            </div>
            <p className="text-xs text-muted-foreground">
              JPEG, PNG or WebP, up to 5 MB. Stored in Microsoft SharePoint Embedded. Profile photos are public.
            </p>
            {uploadMessage && <p role="status" aria-live="polite" className="text-sm" data-testid="avatar-upload-status">{uploadMessage}</p>}
            <Label htmlFor="avatarUrl">Or use a photo URL</Label>
            <Input
              id="avatarUrl"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/photo.jpg"
              type="text"
              disabled={uploading || saving}
            />
            <p className="text-xs text-muted-foreground">
              Shown as your thumbnail on blog post headers and OG images. Synced from Microsoft Entra on sign-in if left blank.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A short description about you — displayed on blog posts you author."
              rows={4}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              {bio.length}/500 characters
            </p>
          </div>

          <Button type="submit" disabled={saving || uploading}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </div>
    </AdminLayout>
  );
}
