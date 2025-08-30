// DayView.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, Phone, Plus, User } from "lucide-react";

import { isBookingOnDay, toJordanYMD } from "./utils/dates";
import {
  Booking,
  BookingStatus,
  RawBooking,
  RawService,
  BookingService,
} from "@/types";

import BookingDrawer from "./BookingDrawer";
import WalkinModal from "./WalkinModal";
import { useToast } from "@/hooks/use-toast";
import { DateTime } from "luxon";
import { http } from "@/lib/http";
import axios from "axios";

/* ------------------- helpers / type guards ------------------- */
type MaybeServiceId = { service_id?: string | number };

function hasServiceId(obj: unknown): obj is MaybeServiceId {
  return !!obj && typeof obj === "object" && "service_id" in obj;
}

function safeUUID(): string {
  // Use globalThis so it works in browser & SSR without ts-ignore.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

/* ------------- map RawService -> BookingService ------------- */
function mapRawService(s: RawService): BookingService {
  const sid =
    s.service_id ??
    s.id ??
    (s.service && hasServiceId(s.service) ? s.service.service_id : undefined) ??
    safeUUID();

  const name_en = s.service?.name_en ?? s.name_en ?? "";
  const name_ar = s.service?.name_ar ?? s.name_ar ?? "";
  const price = s.service?.price_jd ?? s.price_jd ?? s.price ?? 0;
  const duration_min = s.service?.duration_min ?? s.duration_min ?? 0;
  const staff_level = s.service?.staff_level ?? s.staff_level ?? "";

  return {
    service_id: String(sid),
    name_en,
    name_ar,
    category: s.category ?? "",
    duration_min: Number.isFinite(duration_min) ? duration_min : 0,
    price_jd: Number.isFinite(price) ? price : 0,
    staff_level,
    service: {
      id: String(sid),
      name_en,
      name_ar,
      price: Number.isFinite(price) ? price : 0,
      duration_min: Number.isFinite(duration_min) ? duration_min : 0,
      staff_level,
    },
  };
}

/* -------- normalize RawBooking -> Booking (no any) ---------- */
const normalizeBooking = (raw: RawBooking): Booking => {
  const services: BookingService[] = Array.isArray(raw.booking_services)
    ? raw.booking_services.map(mapRawService)
    : Array.isArray(raw.services)
    ? raw.services.map(mapRawService)
    : [];

  const total_price =
    typeof raw.total_price === "number"
      ? raw.total_price
      : services.reduce((sum, s) => sum + (s.price_jd ?? 0), 0);

  const total_duration =
    typeof raw.total_duration === "number"
      ? raw.total_duration
      : services.reduce((sum, s) => sum + (s.duration_min ?? 0), 0);

  return {
    id: String(raw.id),
    start_at: raw.start_at ?? "",
    end_at: raw.end_at ?? "",
    status: raw.status as BookingStatus,
    customer_phone: raw.customer_phone || raw.phone || "",
    customer_name: raw.customer_name || "",
    notes: raw.notes ?? "",
    created_at: raw.created_at ?? new Date().toISOString(),
    modified_at: raw.modified_at ?? new Date().toISOString(),
    services,
    total_price,
    total_duration,
  };
};

/* ------------------------------- UI ------------------------------- */
interface DayViewProps {
  selectedDate: Date;
  bookings: Booking[];
  refreshKey?: number;
  onBack: () => void;
  onStatusUpdate: (bookingId: string, status: BookingStatus) => Promise<void> | void;
  onBookingUpdate: (booking: Booking) => void;
}

const DayView = ({
  selectedDate,
  bookings: initialBookings,
  refreshKey,
  onBack,
  onStatusUpdate,
  onBookingUpdate,
}: DayViewProps) => {
  const [bookings, setBookings] = useState<Booking[]>(initialBookings);
  const [loading, setLoading] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isWalkinModalOpen, setIsWalkinModalOpen] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);
  const { toast } = useToast();

  // Authenticated refetch for the day
  const refetchDay = () => {
    const controller = new AbortController();
    const run = async () => {
      try {
        setLoading(true);
        const dayISO = toJordanYMD(selectedDate, "Asia/Amman");
        const res = await http.get<{ bookings: RawBooking[] }>("/bookings/day", {
          params: { date: dayISO },
          signal: controller.signal,
        });
        const list = Array.isArray(res.data?.bookings) ? res.data.bookings : [];
        setBookings(list.map(normalizeBooking));
      } catch (err) {
        if (axios.isCancel(err)) return;
        console.error("Failed to load day bookings", err);
        setBookings([]);
      } finally {
        setLoading(false);
      }
    };
    void run();
    return () => controller.abort();
  };

  // If parent didn’t give data, fetch; otherwise keep parent’s data
  useEffect(() => {
    if (!initialBookings || initialBookings.length === 0) {
      return refetchDay();
    }
    setBookings(initialBookings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, refreshKey, localRefresh, initialBookings]);

  const handleStatusUpdateWithDrawer = async (bookingId: string, status: BookingStatus) => {
    await onStatusUpdate(bookingId, status);
    if (status === "cancelled") {
      setIsDrawerOpen(false);
      setSelectedBooking(null);
    }
    setLocalRefresh((k) => k + 1);
  };

  const formatTime = (iso: string | null | undefined, zone = "Asia/Amman") => {
    if (!iso) return "--";
    const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
    if (!dt.isValid) return "--";
    return dt.toFormat("hh:mm a");
  };

  const getStatusBadge = (status: BookingStatus) => {
    const statusConfig = {
      confirmed: { class: "bg-blue-50 text-blue-700 border-blue-200", label: "Confirmed" },
      arrived:   { class: "bg-green-50 text-green-700 border-green-200", label: "Arrived" },
      done:      { class: "bg-gray-50 text-gray-700 border-gray-200", label: "Completed" },
      cancelled: { class: "bg-red-50 text-red-700 border-red-200", label: "Cancelled" },
    } as const;
    const cfg = statusConfig[status];
    return (
      <Badge variant="outline" className={`${cfg.class} text-xs font-medium px-2 py-1`}>
        {cfg.label}
      </Badge>
    );
  };

  const bookingsForDay = bookings.filter((b) => isBookingOnDay(b.start_at, selectedDate));
  const sortedBookings = [...bookingsForDay].sort(
    (a, b) =>
      DateTime.fromISO(a.start_at).toMillis() -
      DateTime.fromISO(b.start_at).toMillis()
  );

  const isToday = selectedDate.toDateString() === new Date().toDateString();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="sm" onClick={onBack} className="lovable-transition">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Calendar
          </Button>
          <div>
            <h2 className="text-3xl font-bold text-gray-900">
              {selectedDate.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </h2>
            {isToday && <p className="text-sm text-primary font-medium">Today</p>}
          </div>
        </div>
        <Button
          onClick={() => setIsWalkinModalOpen(true)}
          className="lovable-shadow lovable-transition hover:scale-105"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Booking
        </Button>
      </div>

      {/* Daily Schedule */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-xl font-semibold mb-2">
          <Clock className="w-5 h-5 text-primary" />
          Daily Schedule ({sortedBookings.length} bookings)
        </h3>

        <div className="grid gap-4">
          {loading ? (
            <Card className="lovable-shadow">
              <CardContent className="p-12 text-center">
                <div className="text-gray-400 mb-4">Loading bookings...</div>
              </CardContent>
            </Card>
          ) : sortedBookings.length === 0 ? (
            <Card className="lovable-shadow">
              <CardContent className="p-12 text-center">
                <div className="text-gray-400 mb-4">
                  <User className="w-16 h-16 mx-auto" />
                </div>
                <h3 className="text-lg font-semibold text-gray-600 mb-2">
                  No bookings today
                </h3>
                <p className="text-gray-500 mb-4">Start by adding a walk-in booking</p>
                <Button onClick={() => setIsWalkinModalOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Walk-in
                </Button>
              </CardContent>
            </Card>
          ) : (
            sortedBookings.map((booking) => {
              const totalPrice = (booking.services ?? []).reduce(
                (sum, s) => sum + (typeof s.price_jd === "number" ? s.price_jd : 0),
                0
              );
              const totalDur = (booking.services ?? []).reduce(
                (sum, s) => sum + (typeof s.duration_min === "number" ? s.duration_min : 0),
                0
              );

              return (
                <Card
                  key={booking.id}
                  className="lovable-shadow lovable-transition cursor-pointer hover:shadow-lg hover:scale-[1.02]"
                  onClick={() => {
                    setSelectedBooking(booking);
                    setIsDrawerOpen(true);
                  }}
                >
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start">
                      {/* Left: time, badge, details */}
                      <div className="flex-1">
                        <div className="flex items-center space-x-4 mb-3">
                          <div className="text-lg font-semibold text-rose-600">
                            {formatTime(booking.start_at)}
                          </div>
                          {getStatusBadge(booking.status)}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-start space-x-2">
                            <span className="font-medium">Customer:</span>
                            <span className="text-gray-700">
                              {booking.customer_name || "—"}
                            </span>
                          </div>

                          <div className="flex items-start space-x-2">
                            <span className="font-medium">Services:</span>
                            <span className="text-gray-600">
                              {(booking.services ?? [])
                                .map((bs) => bs.name_en || "")
                                .join(", ")}
                            </span>
                          </div>

                          {booking.customer_phone && (
                            <div className="flex items-start space-x-2">
                              <span className="font-medium">Phone:</span>
                              <span className="inline-flex items-center gap-1 text-gray-600">
                                <Phone className="w-3 h-3" />
                                {booking.customer_phone}
                              </span>
                            </div>
                          )}

                          {booking.notes && (
                            <div className="flex items-start space-x-2">
                              <span className="font-medium">Notes:</span>
                              <span className="text-gray-600">{booking.notes}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: price & duration */}
                      <div className="text-right">
                        <div className="text-lg font-bold text-rose-600">
                          {totalPrice} JD
                        </div>
                        <div className="text-sm text-gray-500">{totalDur} min</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* Drawer & Modals */}
      <BookingDrawer
        booking={selectedBooking}
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedBooking(null);
        }}
        onStatusUpdate={handleStatusUpdateWithDrawer}
        onBookingUpdate={onBookingUpdate}
      />

      <WalkinModal
        isOpen={isWalkinModalOpen}
        onClose={() => setIsWalkinModalOpen(false)}
        onSubmit={() => {
          setIsWalkinModalOpen(false);
          setLocalRefresh((k) => k + 1);
          toast({
            title: "Booking Added",
            description: "Walk-in created.",
            duration: 2500,
          });
        }}
      />
    </div>
  );
};

export default DayView;
