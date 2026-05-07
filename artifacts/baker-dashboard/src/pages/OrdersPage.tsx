import { useState } from "react";
import Layout from "@/components/Layout";
import CreateOrderDialog from "@/components/CreateOrderDialog";
import { useListOrders, useCancelOrder } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, X, MessageSquare } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { ListOrdersStatus } from "@workspace/api-client-react";

type Order = {
  id: number;
  orderNumber?: string | null;
  whatsappNumber: string;
  customerName?: string | null;
  bakingDayDate: string;
  quantity: number;
  status: string;
  productName: string;
  totalAmountCents: number;
  yocoPaymentId?: string | null;
  feedback?: string | null;
  createdAt: string;
};

function statusBadge(status: string) {
  if (status === "paid")
    return <Badge className="bg-green-100 text-green-800 border border-green-200">Paid</Badge>;
  if (status === "pending_payment")
    return <Badge className="bg-amber-100 text-amber-800 border border-amber-200">Pending Payment</Badge>;
  if (status === "abandoned")
    return <Badge className="bg-red-100 text-red-800 border border-red-200">Abandoned</Badge>;
  return (
    <Badge variant="outline" className="text-muted-foreground border-border">
      Cancelled
    </Badge>
  );
}

export default function OrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"all" | "pending_payment" | "paid" | "cancelled" | "abandoned">("all");
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const statusFilter = tab === "all" ? undefined : (tab as ListOrdersStatus);
  const { data: orders, isLoading } = useListOrders({ status: statusFilter });

  const cancelMutation = useCancelOrder({
    mutation: {
      onSuccess: () => {
        toast({ title: "Order cancelled" });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/summary"] });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/baking-days"] });
        setCancelTarget(null);
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Failed to cancel order";
        toast({ title: "Error", description: msg, variant: "destructive" });
        setCancelTarget(null);
      },
    },
  });

  const rows = (orders ?? []) as Order[];

  const tabLabel = {
    all: "All Orders",
    pending_payment: "Pending Payment",
    paid: "Paid Orders",
    abandoned: "Abandoned",
    cancelled: "Cancelled Orders",
  }[tab];

  return (
    <Layout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Orders</h1>
            <p className="text-sm text-muted-foreground">All customer orders</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Order
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending_payment">Pending</TabsTrigger>
            <TabsTrigger value="paid">Paid</TabsTrigger>
            <TabsTrigger value="abandoned">Abandoned</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {tabLabel}
              {rows.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">({rows.length})</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : !rows.length ? (
              <p className="text-sm text-muted-foreground p-4 text-center py-10">
                No orders {tab !== "all" ? `with status "${tab.replace("_", " ")}"` : "yet"}.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {rows.map((order) => (
                  <div key={order.id} className="px-4 py-4 flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">
                          {order.customerName || order.whatsappNumber}
                        </span>
                        {order.customerName && (
                          <span className="text-xs text-muted-foreground">{order.whatsappNumber}</span>
                        )}
                        {order.orderNumber && (
                          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                            #{order.orderNumber}
                          </span>
                        )}
                        {statusBadge(order.status)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                        <p>
                          <span className="font-medium">{order.quantity}×</span> {order.productName}
                          {" · "}
                          Pickup: {format(parseISO(order.bakingDayDate), "d MMM yyyy")}
                        </p>
                        <p>
                          <span className="font-medium">R{(order.totalAmountCents / 100).toFixed(2)}</span>
                          {" · "}
                          Ordered {format(parseISO(order.createdAt), "d MMM yyyy, HH:mm")}
                        </p>
                        {order.feedback && (
                          <div className="flex items-start gap-1 mt-1.5 text-foreground/70">
                            <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                            <span className="italic">"{order.feedback}"</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {order.status === "pending_payment" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive shrink-0 gap-1.5"
                        onClick={() => setCancelTarget(order)}
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the order for{" "}
              <strong>{cancelTarget?.customerName || cancelTarget?.whatsappNumber}</strong>{" "}
              ({cancelTarget?.quantity}× loaves for{" "}
              {cancelTarget ? format(parseISO(cancelTarget.bakingDayDate), "d MMM yyyy") : ""}).
              The reserved slot will be released.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Order</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelTarget && cancelMutation.mutate({ id: cancelTarget.id })}
            >
              Cancel Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateOrderDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Layout>
  );
}
