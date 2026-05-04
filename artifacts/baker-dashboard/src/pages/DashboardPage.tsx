import { useState } from "react";
import Layout from "@/components/Layout";
import CreateOrderDialog from "@/components/CreateOrderDialog";
import { useGetBakerSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingBag, CheckCircle, Clock, Plus, Calendar } from "lucide-react";
import { format, parseISO } from "date-fns";

function StatCard({ title, value, icon: Icon, color }: {
  title: string;
  value: number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`p-2.5 rounded-lg ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
          {value === undefined ? (
            <Skeleton className="h-7 w-10 mt-1" />
          ) : (
            <p className="text-2xl font-bold text-foreground">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function statusBadge(status: string) {
  if (status === "paid") return <Badge className="bg-green-100 text-green-800 border-green-200">Paid</Badge>;
  if (status === "pending_payment") return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Pending</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
}

type UpcomingDay = {
  id: number;
  date: string;
  totalAvailable: number;
  paidLoaves: number;
  pendingLoaves: number;
  remaining: number;
};

export default function DashboardPage() {
  const { data, isLoading } = useGetBakerSummary();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Layout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, d MMMM yyyy")}</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Order
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard title="Orders Today" value={data?.totalOrdersToday} icon={ShoppingBag} color="bg-primary" />
          <StatCard title="Paid Today" value={data?.paidToday} icon={CheckCircle} color="bg-green-600" />
          <StatCard title="Pending Today" value={data?.pendingToday} icon={Clock} color="bg-amber-500" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="w-4 h-4" />
                Upcoming Baking Days
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !data?.upcomingDays?.length ? (
                <p className="text-sm text-muted-foreground p-4">No upcoming baking days. Add some in Baking Days.</p>
              ) : (
                <div className="divide-y divide-border">
                  {(data.upcomingDays as UpcomingDay[]).map((day) => (
                    <div key={day.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          {format(parseISO(day.date), "EEE, d MMM yyyy")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="text-green-700 font-medium">{day.paidLoaves} sold</span>
                          {" · "}
                          <span className="text-amber-600 font-medium">{day.pendingLoaves} held</span>
                          {" · "}
                          <span className="font-medium">{day.remaining} free</span>
                          {" of "}
                          {day.totalAvailable} loaves
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{day.remaining}</p>
                        <p className="text-xs text-muted-foreground">available</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBag className="w-4 h-4" />
                Recent Orders
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !data?.recentOrders?.length ? (
                <p className="text-sm text-muted-foreground p-4">No orders yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {data.recentOrders.map((order) => (
                    <div key={order.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          {order.customerName || order.whatsappNumber}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.quantity}× {order.productName} · {format(parseISO(order.bakingDayDate), "d MMM")}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {statusBadge(order.status)}
                        <p className="text-xs text-muted-foreground">
                          R{(order.totalAmountCents / 100).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CreateOrderDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Layout>
  );
}
