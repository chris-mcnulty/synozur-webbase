import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/components/admin/AdminGate";
import {
  OrderedBlocksEditor,
  type OrderedBlock,
} from "@/components/admin/OrderedBlocksEditor";
import { useToast } from "@/hooks/use-toast";
import {
  useCmsListSolutions,
  useCmsListSolutionCapabilities,
  useCmsCreateCapability,
  useCmsUpdateCapability,
  useCmsDeleteCapability,
  type Solution,
} from "@workspace/api-client-react";

export default function SolutionCapabilitiesPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { access } = useAdminAccess();
  const { toast } = useToast();
  const canWrite = !!access?.isEditorOrAbove;

  const solutionsQ = useCmsListSolutions();
  const solution = (solutionsQ.data?.items ?? []).find((s: Solution) => s.id === id);

  const listQ = useCmsListSolutionCapabilities(id);
  const items: OrderedBlock[] = (listQ.data?.items ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    displayOrder: c.displayOrder,
    iconId: c.iconId,
    iconUrl: c.iconUrl,
    bodyHtml: c.bodyHtml,
    hidden: c.hidden,
  }));

  const createMut = useCmsCreateCapability({
    mutation: {
      onSuccess: () => listQ.refetch(),
      onError: (e: Error) =>
        toast({ title: "Add failed", description: e.message, variant: "destructive" }),
    },
  });
  const updateMut = useCmsUpdateCapability({
    mutation: {
      onError: (e: Error) =>
        toast({ title: "Save failed", description: e.message, variant: "destructive" }),
      onSuccess: () => listQ.refetch(),
    },
  });
  const deleteMut = useCmsDeleteCapability({
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
      title={`Capabilities${solution ? `: ${solution.title}` : ""}`}
      crumbs={[
        { label: "Admin", href: "/" },
        { label: "Solutions", href: "/products/solutions" },
        { label: solution?.title ?? "Solution" },
        { label: "Capabilities" },
      ]}
      actions={
        <Button variant="ghost" onClick={() => navigate("/products/solutions")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to solutions
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
        emptyMessage="No capability blocks yet."
        testIdPrefix="capability"
        onCreate={async ({ title }) => {
          const next = (items.at(-1)?.displayOrder ?? 0) + 1;
          await createMut.mutateAsync({
            data: { solutionId: id, title, displayOrder: next, hidden: false },
          });
        }}
        onUpdate={async (cid, data) => {
          await updateMut.mutateAsync({
            id: cid,
            data: {
              ...data,
              solutionId: id,
              title: data.title ?? items.find((i) => i.id === cid)?.title ?? "",
            },
          });
        }}
        onDelete={async (cid) => {
          await deleteMut.mutateAsync({ id: cid });
        }}
        onReorder={async (entries) => {
          await Promise.all(
            entries.map((e) =>
              updateMut.mutateAsync({
                id: e.id,
                data: {
                  solutionId: id,
                  title: items.find((i) => i.id === e.id)?.title ?? "",
                  displayOrder: e.displayOrder,
                },
              }),
            ),
          );
        }}
      />
    </AdminLayout>
  );
}
