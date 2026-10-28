import { useState } from "react";
import { useProvisionEntraUser } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EntraUserForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [objectId, setObjectId] = useState("");
  const [editor, setEditor] = useState(true);
  const [author, setAuthor] = useState(false);
  const create = useProvisionEntraUser();

  return (
    <Card className="mb-6 p-5">
      <h2 className="font-semibold mb-2">Add Entra user</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Prepare website access for an existing user in our Microsoft tenant. They do not need to visit first.
        This does not create a Microsoft account or send an invitation.
      </p>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        if (create.isPending || (!editor && !author)) return;
        create.mutate({ data: {
          email: email.trim(), ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          ...(objectId.trim() ? { objectId: objectId.trim() } : {}),
          roles: [...(editor ? ["editor" as const] : []), ...(author ? ["content_author" as const] : [])],
        } }, { onSuccess: onCreated });
      }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="entra-email">Microsoft work sign-in email</Label>
            <Input id="entra-email" type="email" required value={email} disabled={create.isPending} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entra-name">Display name (optional)</Label>
            <Input id="entra-name" maxLength={120} value={displayName} disabled={create.isPending} onChange={e => setDisplayName(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="entra-object-id">Entra Object ID (optional)</Label>
          <Input id="entra-object-id" value={objectId} disabled={create.isPending} onChange={e => setObjectId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          <p className="text-xs text-muted-foreground">
            Leave blank for automatic directory lookup. If lookup is unavailable, copy the Object ID from Microsoft Entra → Users → the user → Overview.
            Use this tenant's user Object ID, not an application or group ID. Access is bound to this identity, not just an email.
          </p>
        </div>
        <fieldset className="space-y-2" disabled={create.isPending}>
          <legend className="text-sm font-medium mb-2">Website roles</legend>
          <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={editor} onChange={e => setEditor(e.target.checked)} />Editor</label>
          <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={author} onChange={e => setAuthor(e.target.checked)} />Content author (not Guest author)</label>
          <p className="text-xs text-muted-foreground">Explicitly saved roles remain assigned when Entra groups are refreshed. You can change or remove them here later.</p>
        </fieldset>
        {create.isError && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending || (!editor && !author)}>{create.isPending ? "Preparing access…" : "Prepare website access"}</Button>
          <Button type="button" variant="outline" disabled={create.isPending} onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
