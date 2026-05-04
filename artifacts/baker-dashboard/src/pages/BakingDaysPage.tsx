import { useState } from "react";
import Layout from "@/components/Layout";
import CreateOrderDialog from "@/components/CreateOrderDialog";
import {
  useListBakingDays,
  useCreateBakingDay,
  useUpdateBakingDay,
  useDeleteBakingDay,
  useListProducts,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Lock, CalendarDays } from "lucide-react";
import { format, parseISO } from "date-fns";

type BakingDayRow = {
  id: number;
  date: string;
  productId: number;
  productName: string;
  totalAvailable: number;
  reservedCount: number;
  paidCount: number;
  pendingCount: number;
  paidLoaves: number;
  pendingLoaves: number;
  remaining: number;
  editable?: boolean;
};

function AddDayDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: products } = useListProducts();
  const [date, setDate] = useState("");
  const [total, setTotal] = useState("10");

  const productId = products?.[0]?.id;

  const create = useCreateBakingDay({
    mutation: {
      onSuccess: () => {
        toast({ title: "Baking day added" });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/baking-days"] });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/summary"] });
        onOpenChange(false);
        setDate("");
        setTotal("10");
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Failed to add baking day";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  const minDate = new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString().split("T")[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Baking Day</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Must be at least 48 hours from now</p>
          </div>
          <div className="space-y-1.5">
            <Label>Loaves Available</Label>
            <Input type="number" min={1} max={200} value={total} onChange={(e) => setTotal(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!date || !total || !productId || create.isPending}
            onClick={() => create.mutate({ data: { date, productId: productId!, totalAvailable: Number(total) } })}
          >
            {create.isPending ? "Adding…" : "Add Day"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDayDialog({
  day,
  open,
  onOpenChange,
}: {
  day: BakingDayRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [total, setTotal] = useState(String(day.totalAvailable));

  const update = useUpdateBakingDay({
    mutation: {
      onSuccess: () => {
        toast({ title: "Availability updated" });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/baking-days"] });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/summary"] });
        onOpenChange(false);
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Failed to update";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit {format(parseISO(day.date), "d MMM yyyy")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Total Loaves Available</Label>
            <Input
              type="number"
              min={day.paidLoaves + day.pendingLoaves}
              max={200}
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Minimum {day.paidLoaves + day.pendingLoaves} ({day.paidLoaves} sold + {day.pendingLoaves} held)
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={Number(total) < day.paidLoaves + day.pendingLoaves || update.isPending}
            onClick={() => update.mutate({ id: day.id, data: { totalAvailable: Number(total) } })}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BakingDaysPage() {
  const { data: days, isLoading } = useListBakingDays();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editDay, setEditDay] = useState<BakingDayRow | null>(null);
  const [deleteDay, setDeleteDay] = useState<BakingDayRow | null>(null);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);

  const cutoff48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split("T")[0];

  const deleteMutation = useDeleteBakingDay({
    mutation: {
      onSuccess: () => {
        toast({ title: "Baking day deleted" });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/baking-days"] });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/summary"] });
        setDeleteDay(null);
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Failed to delete";
        toast({ title: "Error", description: msg, variant: "destructive" });
        setDeleteDay(null);
      },
    },
  });

  const rows = (days ?? []) as BakingDayRow[];

  return (
    <Layout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Baking Days</h1>
            <p className="text-sm text-muted-foreground">Manage your upcoming baking schedule</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCreateOrderOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              New Order
            </Button>
            <Button onClick={() => setAddOpen(true)} className="gap-2">
              <CalendarDays className="w-4 h-4" />
              Add Day
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">All Baking Days</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : !rows.length ? (
              <p className="text-sm text-muted-foreground p-4 text-center py-8">
                No baking days yet. Add your first one!
              </p>
            ) : (
              <div className="divide-y divide-border">
                {rows.map((day) => {
                  const editable = day.date >= cutoff48h;
                  const isPast = day.date < new Date().toISOString().split("T")[0];
                  return (
                    <div key={day.id} className="px-4 py-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">
                            {format(parseISO(day.date), "EEEE, d MMMM yyyy")}
                          </p>
                          {isPast && <Badge variant="outline" className="text-xs text-muted-foreground">Past</Badge>}
                          {!editable && !isPast && (
                            <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-200 gap-1">
                              <Lock className="w-2.5 h-2.5" /> Locked (within 48h)
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1">
                          <span className="text-xs text-muted-foreground">
                            <span className="font-medium text-green-700">{day.paidLoaves} sold</span>
                            {" · "}
                            <span className="font-medium text-amber-600">{day.pendingLoaves} held</span>
                            {" · "}
                            <span className="font-medium">{day.remaining} free</span>
                            {" of "}
                            {day.totalAvailable} loaves
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!editable}
                          onClick={() => setEditDay(day)}
                          title={editable ? "Edit availability" : "Locked: less than 48h away"}
                        >
                          {editable ? <Pencil className="w-4 h-4" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!editable || day.reservedCount > 0}
                          onClick={() => setDeleteDay(day)}
                          className="text-destructive hover:text-destructive"
                          title={
                            !editable ? "Locked" :
                            day.reservedCount > 0 ? "Cannot delete: has reservations" :
                            "Delete"
                          }
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AddDayDialog open={addOpen} onOpenChange={setAddOpen} />
      {editDay && (
        <EditDayDialog day={editDay} open={!!editDay} onOpenChange={(v) => !v && setEditDay(null)} />
      )}
      <AlertDialog open={!!deleteDay} onOpenChange={(v) => !v && setDeleteDay(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Baking Day?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the baking day for{" "}
              {deleteDay ? format(parseISO(deleteDay.date), "d MMMM yyyy") : ""}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteDay && deleteMutation.mutate({ id: deleteDay.id })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CreateOrderDialog open={createOrderOpen} onOpenChange={setCreateOrderOpen} />
    </Layout>
  );
}
