import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useListBakingDays, useCreateOrder } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateOrderDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [bakingDayId, setBakingDayId] = useState<string>("");
  const [quantity, setQuantity] = useState("1");

  const { data: bakingDays } = useListBakingDays({ upcoming: true });

  const cutoff48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split("T")[0];
  const eligibleDays = (bakingDays ?? []).filter(
    (d) => d.date >= cutoff48h && (d.totalAvailable - d.reservedCount) > 0
  );

  const selectedDay = eligibleDays.find((d) => String(d.id) === bakingDayId);
  const maxQty = selectedDay ? selectedDay.totalAvailable - selectedDay.reservedCount : 99;

  const mutation = useCreateOrder({
    mutation: {
      onSuccess: () => {
        toast({ title: "Order created", description: "WhatsApp notification sent to customer." });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/summary"] });
        queryClient.invalidateQueries({ queryKey: ["/api/baker/baking-days"] });
        onOpenChange(false);
        setWhatsappNumber("");
        setCustomerName("");
        setBakingDayId("");
        setQuantity("1");
      },
      onError: (err: Error) => {
        toast({ title: "Failed to create order", description: err.message, variant: "destructive" });
      },
    },
  });

  const canSubmit =
    whatsappNumber.trim().length >= 7 &&
    bakingDayId !== "" &&
    Number(quantity) >= 1 &&
    Number(quantity) <= maxQty;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Order for Customer</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="whatsapp">WhatsApp Number *</Label>
            <Input
              id="whatsapp"
              placeholder="+27821234567"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Include country code (e.g. +27 for South Africa)</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Customer Name</Label>
            <Input
              id="name"
              placeholder="Optional"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Baking Day *</Label>
            <Select value={bakingDayId} onValueChange={setBakingDayId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a baking day" />
              </SelectTrigger>
              <SelectContent>
                {eligibleDays.length === 0 ? (
                  <SelectItem value="_none" disabled>No available days (≥48h away)</SelectItem>
                ) : (
                  eligibleDays.map((d) => {
                    const remaining = d.totalAvailable - d.reservedCount;
                    return (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {format(parseISO(d.date), "EEE, d MMM yyyy")} — {remaining} left
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qty">Quantity *</Label>
            <Input
              id="qty"
              type="number"
              min={1}
              max={maxQty}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            {selectedDay && (
              <p className="text-xs text-muted-foreground">
                Max {maxQty} loaf(ves) available for this day
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              mutation.mutate({
                data: {
                  whatsappNumber: whatsappNumber.trim(),
                  customerName: customerName.trim() || undefined,
                  bakingDayId: Number(bakingDayId),
                  quantity: Number(quantity),
                },
              })
            }
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? "Creating…" : "Create & Notify Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
