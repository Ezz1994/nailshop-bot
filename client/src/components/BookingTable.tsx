import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar as CalendarIcon } from "lucide-react";
import { Booking, BookingStatus,BookingService  } from "@/types";
import BookingDrawer from "./BookingDrawer";
import ErrorBoundary from "./ErrorBoundary";
import WalkinModal from "./WalkinModal";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";


interface BookingTableProps {
  selectedDate: string;
}

/* ---------------------- helpers (no any) ---------------------- */
type AnyRec = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const pickString = (...vals: unknown[]): string => {
  for (const v of vals) if (typeof v === "string") return v;
  return "";
};
const pickNumber = (...vals: unknown[]): number => {
  for (const v of vals) if (typeof v === "number" && !Number.isNaN(v)) return v;
  return 0;
};

/* ---------------- normalize API payload safely ---------------- */
const normalizeBooking = (raw: AnyRec): Booking => {
  const r = raw as AnyRec;

  // services[]
// services[]
const services: BookingService[] = Array.isArray(r.services)
  ? r.services
      .filter(isRecord)
      .map((s): BookingService => ({
        service_id: pickString((s as AnyRec).service_id),
        name_en: pickString((s as AnyRec).name_en),
        name_ar: pickString((s as AnyRec).name_ar),
        category: pickString((s as AnyRec).category),
        duration_min: pickNumber((s as AnyRec).duration_min),
        price_jd: pickNumber((s as AnyRec).price_jd),   // <-- make sure it's price_jd, not price_id
        staff_level: pickString((s as AnyRec).staff_level),
      }))
  : [];


  // nested customer object (optional)
  const customerObj = isRecord(r.customer) ? (r.customer as AnyRec) : undefined;

  const customer_name = pickString(
    r.customer_name,
    (r as AnyRec).customer_name_en,
    r.name,
    (r as AnyRec).name_en,
    customerObj?.name,
    customerObj?.name_en
  );

  const customer_phone = pickString(
    r.customer_phone,
    r.phone,
    customerObj?.phone
  );

  return {
    id:
      typeof r.id === "string"
        ? r.id
        : typeof r.id === "number"
        ? String(r.id)
        : "",
    services,
    total_price: pickNumber(r.total_price),
    total_duration: pickNumber(r.total_duration),
    customer_phone,
    customer_name,
    notes: pickString(r.notes),
    end_at: pickString(r.end_at),
    start_at: pickString(r.start_at),
    status:
      typeof r.status === "string" &&
      ["confirmed", "arrived", "done", "cancelled"].includes(r.status)
        ? (r.status as "confirmed" | "arrived" | "done" | "cancelled")
        : "confirmed",
    created_at:
      typeof r.created_at === "string"
        ? r.created_at
        : new Date().toISOString(),
    modified_at:
      typeof r.modified_at === "string"
        ? r.modified_at
        : new Date().toISOString(),
  };
};

const BookingTable = ({ selectedDate }: BookingTableProps) => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isWalkinModalOpen, setIsWalkinModalOpen] = useState(false);
  const { toast } = useToast();

  const [refreshKey, setRefreshKey] = useState(0);

  // Force a lightweight re-render periodically so header date updates at Jordan midnight
  const [, forceRerender] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      forceRerender((v) => v + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch bookings
  useEffect(() => {
    setLoading(true);
    setError(null);
    api(`/bookings/today`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load bookings");
        return res.json();
      })
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.bookings as unknown[]) ?? [];
        setBookings(arr.filter(isRecord).map((b) => normalizeBooking(b)));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load bookings");
        setBookings([]);
        setLoading(false);
      });
  }, [selectedDate, refreshKey]);

  const getStatusBadge = (status: BookingStatus) => {
    const statusClasses = {
      confirmed: "status-confirmed",
      arrived: "status-arrived",
      done: "status-done",
      cancelled: "status-cancelled",
    };
    return (
      <Badge variant="outline" className={`${statusClasses[status]} lovable-transition`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatTime = (dateTime: string) =>
    new Date(dateTime).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

  const handleBookingClick = (booking: Booking) => {
    setSelectedBooking(booking);
    setIsDrawerOpen(true);
  };

  const handleStatusUpdate = async (bookingId: string, status: BookingStatus) => {
    if (status === "cancelled") {
      try {
        const res = await api(`/bookings/${bookingId}/cancel`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to cancel booking");

        setBookings((prev) =>
          prev.map((b) =>
            b.id === bookingId ? { ...b, status, modified_at: new Date().toISOString() } : b
          )
        );
        if (selectedBooking?.id === bookingId) {
          setSelectedBooking((prev) =>
            prev ? { ...prev, status, modified_at: new Date().toISOString() } : null
          );
        }
        toast({ title: "Booking Cancelled", description: "Booking was cancelled successfully.", duration: 3000 });
        setRefreshKey((k) => k + 1);
        setIsDrawerOpen(false);
      } catch (err) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : String(err),
          duration: 3000,
          variant: "destructive",
        });
      }
      return;
    }

    setBookings((prev) =>
      prev.map((b) =>
        b.id === bookingId ? { ...b, status, modified_at: new Date().toISOString() } : b
      )
    );
    if (selectedBooking?.id === bookingId) {
      setSelectedBooking((prev) =>
        prev ? { ...prev, status, modified_at: new Date().toISOString() } : null
      );
    }
    const statusMessages = {
      confirmed: "Booking confirmed",
      arrived: "Customer marked as arrived",
      done: "Booking completed",
      cancelled: "Booking cancelled",
    };
    toast({ title: "Status Updated", description: statusMessages[status], duration: 3000 });
    setRefreshKey((k) => k + 1);
  };

  const handleBookingUpdate = (updatedBooking: Booking) => {
    setBookings((prev) =>
      prev.map((b) => (b.id === updatedBooking.id ? { ...updatedBooking, modified_at: new Date().toISOString() } : b))
    );
    setSelectedBooking({ ...updatedBooking, modified_at: new Date().toISOString() });
    setRefreshKey((k) => k + 1);
    toast({ title: "Booking Updated", description: "Booking details have been successfully updated", duration: 3000 });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h2 className="text-3xl font-bold text-gray-900">Today's Bookings</h2>
          <div className="flex items-center text-sm text-gray-600">
            <CalendarIcon className="w-4 h-4 mr-1" />
            {new Date().toLocaleDateString("en-US", {
              timeZone: "Asia/Amman",
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>

        <Button onClick={() => setIsWalkinModalOpen(true)} className="lovable-shadow lovable-transition hover:scale-105">
          <Plus className="w-4 h-4 mr-2" />
          Walk-in
        </Button>
      </div>

      {/* Bookings List */}
      <div className="grid gap-4">
        {loading ? (
          <Card className="lovable-shadow">
            <CardContent className="p-12 text-center">
              <div className="text-gray-400 mb-4">Loading bookings...</div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="lovable-shadow">
            <CardContent className="p-12 text-center">
              <div className="text-red-500 mb-4">{error}</div>
            </CardContent>
          </Card>
        ) : bookings.length === 0 ? (
          <Card className="lovable-shadow">
            <CardContent className="p-12 text-center">
              <div className="text-gray-400 mb-4">
                <CalendarIcon className="w-16 h-16 mx-auto" />
              </div>
              <h3 className="text-lg font-semibold text-gray-600 mb-2">No bookings today</h3>
              <p className="text-gray-500 mb-4">Start by adding a walk-in booking</p>
              <Button onClick={() => setIsWalkinModalOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Walk-in
              </Button>
            </CardContent>
          </Card>
        ) : (
          bookings.map((booking) => (
            <Card
              key={booking.id}
              className="lovable-shadow lovable-transition cursor-pointer hover:shadow-lg hover:scale-[1.02]"
              onClick={() => handleBookingClick(booking)}
            >
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center space-x-4 mb-3">
                      <div className="text-lg font-semibold text-primary">{formatTime(booking.start_at)}</div>
                      {getStatusBadge(booking.status)}
                    </div>

                    <div className="space-y-2">
                      {/* Customer Name */}
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">Customer:</span>
                        <span className="text-gray-900">{booking.customer_name || "Walk-in"}</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span className="font-medium">Services:</span>
                        <span className="text-gray-600">
                          {(booking.services ?? []).map((s) => s.name_en || "").join(", ")}
                        </span>
                      </div>

                      {booking.customer_phone && (
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">Phone:</span>
                          <span className="text-gray-600">{booking.customer_phone}</span>
                        </div>
                      )}

                      {booking.notes && (
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">Notes:</span>
                          <span className="text-gray-600">{booking.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-bold text-primary">{booking.total_price} JD</div>
                    <div className="text-sm text-gray-500">{booking.total_duration} min</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Booking Drawer */}
      <ErrorBoundary resetKeys={[isDrawerOpen, selectedBooking?.id]}>
        <BookingDrawer
          booking={selectedBooking}
          isOpen={isDrawerOpen}
          onClose={() => {
            setIsDrawerOpen(false);
            setSelectedBooking(null);
          }}
          onStatusUpdate={handleStatusUpdate}
          onBookingUpdate={handleBookingUpdate}
        />
      </ErrorBoundary>

      {/* Walk-in Modal */}
      <WalkinModal
        isOpen={isWalkinModalOpen}
        onClose={() => setIsWalkinModalOpen(false)}
        onSubmit={() => {
          setIsWalkinModalOpen(false);
          setRefreshKey((prev) => prev + 1);
        }}
      />
    </div>
  );
};

export default BookingTable;
