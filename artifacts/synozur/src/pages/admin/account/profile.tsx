import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/auth";
import { useToast } from "@/hooks/use-toast";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export default function AdminProfile() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? "");
      setBio(user.bio ?? "");
      setAvatarUrl(user.avatarUrl ?? "");
    }
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, string | null> = {
        displayName: displayName.trim() || null,
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

  const avatarPreview = avatarUrl.trim() || user?.avatarUrl;

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
            <Label htmlFor="avatarUrl">Avatar URL</Label>
            <Input
              id="avatarUrl"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/photo.jpg"
              type="url"
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

          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </div>
    </AdminLayout>
  );
}
