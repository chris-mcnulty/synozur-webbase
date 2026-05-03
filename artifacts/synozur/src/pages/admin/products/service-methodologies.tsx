import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  OrderedBlocksEditor,
  type OrderedBlock,
} from "@/components/admin/OrderedBlocksEditor";
import { RevisionsPanel } from "@/components/admin/RevisionsPanel";
import { useToast } from "@/hooks/use-toast";
import {
  useCmsListServices,
  useCmsListServiceMethodologies,
  useCmsCreateMethodology,
  useCmsUpdateMethodology,
  useCmsDeleteMethodology,
  getCmsListServiceMethodologiesQueryKey,
  type Service,
} from "@workspace/api-client-react";

export default function ServiceMethodologiesPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;
  // #61: id of the methodology block whose revision history dialog is open.
  const [historyId, setHistoryId] = useState<string | null>(null);

  const servicesQ = useCmsListServices();
  const service = (servicesQ.data?.items ?? []).find((s: Service) => s.id === id);

  const listQ = useCmsListServiceMethodologies(id);
  const items: OrderedBlock[] = (listQ.data?.items ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    displayOrder: m.displayOrder,
    iconId: m.iconId,
    iconUrl: m.iconUrl,
    bodyHtml: m.bodyHtml,
    hidden: m.hidden,
  }));

  const createMut = useCmsCreateMethodology({
    mutation: {
      onSuccess: () => listQ.refetch(),
      onError: (e: Error) =>
        toast({ title: "Add failed", description: e.message, variant: "destructive" }),
    },
  });
  const updateMut = useCmsUpdateMethodology({
    mutation: {
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
      onSuccess: () => listQ.refetch(),
    },
  });
  const deleteMut = useCmsDeleteMethodology({
    mutation: {
      onSuccess: () => {
        toast({ title: "Block deleted" });
        listQ.refetch();
      },
      onError: (e: Error) =>
        toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });

  return (
    <AdminLayout
      title={`Methodologies${service ? `: ${service.title}` : ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Services", href: "/products/services" },
        { label: service?.title ?? "Service" },
        { label: "Methodologies" },
      ]}
      actions={
        <Button variant="ghost" onClick={() => navigate("/products/services")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to services
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground mb-4">
        Drag to reorder blocks. Inline-edit titles, toggle visibility, swap icons. Click
        the pencil to edit the body.
      </p>
      <OrderedBlocksEditor
        blocks={items}
        canWrite={canWrite}
        isLoading={listQ.isLoading}
        emptyMessage="No methodology blocks yet."
        testIdPrefix="methodology"
        onCreate={async ({ title }) => {
          const next = (items.at(-1)?.displayOrder ?? 0) + 1;
          await createMut.mutateAsync({
            data: { serviceId: id, title, displayOrder: next, hidden: false },
          });
        }}
        onUpdate={async (mid, data) => {
          await updateMut.mutateAsync({ id: mid, data: { ...data, serviceId: id, title: data.title ?? items.find((i) => i.id === mid)?.title ?? "" } });
        }}
        onDelete={async (mid) => {
          await deleteMut.mutateAsync({ id: mid });
        }}
        onReorder={async (entries) => {
          await Promise.all(
            entries.map((e) =>
              updateMut.mutateAsync({
                id: e.id,
                data: {
                  serviceId: id,
                  title: items.find((i) => i.id === e.id)?.title ?? "",
                  displayOrder: e.displayOrder,
                },
              }),
            ),
          );
        }}
        onShowHistory={(mid) => setHistoryId(mid)}
      />

      <Dialog
        open={!!historyId}
        onOpenChange={(o) => !o && setHistoryId(null)}
      >
        <DialogContent
          className="max-w-2xl"
          data-testid="methodology-history-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              Revision history
              {historyId && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {items.find((i) => i.id === historyId)?.title ?? ""}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {historyId && (
            <RevisionsPanel
              kind="methodology"
              id={historyId}
              alwaysOpen
              invalidateKeys={[getCmsListServiceMethodologiesQueryKey(id)]}
            />
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
