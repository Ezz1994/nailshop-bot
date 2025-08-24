// weeklyCalendar.tsx
import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isBookingOnDay } from "./utils/dates";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Eye } from "lucide-react";
import { Booking, BookingStatus, RawService, RawBooking, BookingService } from "@/types";
import BookingDrawer from "./BookingDrawer";
import WalkinModal from "./WalkinModal";
import DayView from "./DayView";
import { useToast } from "@/hooks/use-toast";
import { http } from "@/lib/http";                 // ✅ use the authenticated axios client

const toJordanYMD = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

// --- Normalization helper (handles services OR booking_services) ---
const normalizeBooking = (raw: RawBooking): Booking => {
  type RawBookingEither = RawBooking & {
    services?: RawService[];
    booking_services?: RawService[];
    phone?: string;
  };

  type RawServiceEither = RawService & {
    id?: string;
    price?: number;
    price_jd?: number;
    category?: string;
    service?: {
      id?: string;
      name_en?: string;
      name_ar?: string;
      price?: number;
      price_jd?: number;
      duration_min?: number;
      staff_level?: string;
    };
  };

  const rb = raw as RawBookingEither;

  const rawSvcs: RawService[] = Array.isArray(rb.services)
    ? rb.services
    : Array.isArray(rb.booking_services)
    ? rb.booking_services
    : [];

  return {
    id: rb.id,
    start_at: rb.start_at,
    end_at: rb.end_at,
    status: rb.status,
    customer_phone: rb.customer_phone ?? rb.phone ?? "",
    customer_name: rb.customer_name ?? "",
    notes: rb.notes ?? "",
    created_at: rb.created_at,
    modified_at: rb.modified_at,
    services: rawSvcs.map((s0): BookingService => {
      const s = s0 as RawServiceEither;

      const sid =
        s.service_id ??
        s.id ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Math.random()).slice(2));

      const price =
        s.service?.price_jd ?? s.service?.price ?? s.price_jd ?? s.price ?? 0;

      const duration = s.service?.duration_min ?? s.duration_min ?? 0;
      const staff = s.service?.staff_level ?? s.staff_level ?? "";

      return {
        service_id: sid,
        name_en: s.service?.name_en ?? s.name_en ?? "",
        name_ar: s.service?.name_ar ?? s.name_ar ?? "",
        category: s.category ?? "",
        duration_min: duration,
        price_jd: price,
        staff_level: staff,
        service: {
          id: s.service?.id ?? sid,
          name_en: s.service?.name_en ?? s.name_en ?? "",
          name_ar: s.service?.name_ar ?? s.name_ar ?? "",
          price,
          duration_min: duration,
          staff_level: staff,
        },
      };
    }),
    total_price: typeof rb.total_price === "number" ? rb.total_price : 0,
    total_duration: typeof rb.total_duration === "number" ? rb.total_duration : 0,
  };
};

interface WeeklyCalendarProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

const WeeklyCalendar = ({ selectedDate, onDateChange }: WeeklyCalendarProps) => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isWalkinModalOpen, setIsWalkinModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [dayViewDate, setDayViewDate] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { toast } = useToast();

  const getWeekStart = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  };
  const getWeekEnd = (weekStart: Date) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  };

  // ✅ Use authenticated client to fetch bookings
  useEffect(() => {
  const controller = new AbortController();

  (async () => {
    setLoading(true);
    try {
      const weekStart = getWeekStart(selectedDate);
      const weekEnd = getWeekEnd(weekStart);

      const start = toJordanYMD(weekStart);
      const endExclusive = new Date(weekEnd);
      endExclusive.setDate(endExclusive.getDate() + 1);

      const res = await http.get("/bookings/range", {
        params: { start, end: toJordanYMD(endExclusive) },
        signal: controller.signal as AbortSignal, // ✅ no 'any'
      });

      const list = Array.isArray(res.data?.bookings) ? res.data.bookings : [];
      setBookings(list.map(normalizeBooking));
    } catch (err) {
      // ✅ no 'any' — narrow safely
      if (axios.isCancel(err)) return;
      console.error("Failed to load bookings", err);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  })();

  return () => controller.abort();
}, [selectedDate, refreshKey]);


  const getWeekDays = (startDate: Date) => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(startDate);
      day.setDate(startDate.getDate() + i);
      days.push(day);
    }
    return days;
  };

  const navigateWeek = (direction: "prev" | "next") => {
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + (direction === "next" ? 7 : -7));
    onDateChange(newDate);
  };

  const getBookingsForDate = (date: Date) =>
    bookings
      .filter((booking) => isBookingOnDay(booking.start_at, date))
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

  const getStatusBadge = (status: BookingStatus) => {
    const statusConfig = {
      confirmed: { class: "bg-blue-50 text-blue-700 border-blue-200", label: "Confirmed" },
      arrived: { class: "bg-green-50 text-green-700 border-green-200", label: "Arrived" },
      done: { class: "bg-gray-50 text-gray-700 border-gray-200", label: "Completed" },
      cancelled: { class: "bg-red-50 text-red-700 border-red-200", label: "Cancelled" },
    } as const;
    const cfg = statusConfig[status as keyof typeof statusConfig];
    if (!cfg) return null;
    return (
      <Badge variant="outline" className={`${cfg.class} text-xs font-medium px-2 py-1`}>
        {cfg.label}
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

  // ✅ Use authenticated client for cancel
  const handleStatusUpdate = async (bookingId: string, status: BookingStatus) => {
    if (status === "cancelled") {
      setIsDrawerOpen(false);
      setSelectedBooking(null);
      try {
        const res = await http.post(`/bookings/${bookingId}/cancel`);
        if (res.status >= 400) throw new Error("Failed to cancel booking");

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
        setRefreshKey((p) => p + 1);

        toast({
          title: "Booking Cancelled",
          description: "Booking was cancelled successfully.",
          duration: 3000,
        });
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

    // local optimistic update for other statuses
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
    setRefreshKey((p) => p + 1);
  };

  const handleBookingUpdate = (updatedBooking: Booking) => {
    setBookings((prev) =>
      prev.map((b) =>
        b.id === updatedBooking.id ? { ...updatedBooking, modified_at: new Date().toISOString() } : b
      )
    );
    setSelectedBooking({ ...updatedBooking, modified_at: new Date().toISOString() });
    setRefreshKey((p) => p + 1);
    toast({
      title: "Booking Updated",
      description: "Booking details have been successfully updated",
      duration: 3000,
    });
  };

  const isToday = (date: Date) => new Date().toDateString() === date.toDateString();

  const handleDayClick = (date: Date) => {
    setDayViewDate(date);
    setViewMode("day");
  };

  const handleBackToWeek = () => {
    setViewMode("week");
    setDayViewDate(null);
  };

  if (viewMode === "day" && dayViewDate) {
    return (
      <DayView
        selectedDate={dayViewDate}
        bookings={[]}
        refreshKey={refreshKey}
        onBack={handleBackToWeek}
        onStatusUpdate={handleStatusUpdate}
        onBookingUpdate={handleBookingUpdate}
      />
    );
  }

  const weekStart = getWeekStart(selectedDate);
  const weekDays = getWeekDays(weekStart);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h2 className="text-3xl font-bold text-gray-900">Weekly Calendar</h2>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={() => navigateWeek("prev")} className="lovable-transition">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-lg font-medium min-w-[200px] text-center">
              {weekStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
            <Button variant="outline" size="sm" onClick={() => navigateWeek("next")} className="lovable-transition">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <Button onClick={() => setIsWalkinModalOpen(true)} className="lovable-shadow lovable-transition hover:scale-105">
          <CalendarIcon className="w-4 h-4 mr-2" />
          Add Booking
        </Button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-4">
        {weekDays.map((day, index) => {
          const dayBookings = getBookingsForDate(day);
          const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          const hasBookings = dayBookings.length > 0;

          return (
            <Card
              key={index}
              className={`lovable-shadow transition-all duration-200 hover:shadow-lg cursor-pointer ${
                isToday(day) ? "ring-2 ring-primary bg-primary/5" : ""
              } ${hasBookings ? "border-primary/20" : ""}`}
              onClick={() => handleDayClick(day)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-center">
                  <div className="text-sm font-medium text-gray-600 mb-1">{dayNames[index]}</div>
                  <div className={`text-2xl font-bold ${isToday(day) ? "text-primary" : "text-gray-900"}`}>
                    {day.getDate()}
                  </div>
                  {hasBookings && (
                    <div className="flex items-center justify-center gap-1 mt-2">
                      <div className="w-2 h-2 bg-primary rounded-full"></div>
                      <span className="text-xs text-primary font-medium">
                        {dayBookings.length} booking{dayBookings.length > 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-[120px] flex flex-col justify-center">
                {loading ? (
                  <div className="text-center text-gray-400">Loading...</div>
                ) : dayBookings.length === 0 ? (
                  <div className="text-center text-gray-400">
                    <CalendarIcon className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No bookings</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dayBookings.slice(0, 2).map((booking) => (
                      <div
                        key={booking.id}
                        className="bg-primary/10 p-2 rounded text-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBookingClick(booking);
                        }}
                      >
                        <div className="text-xs font-medium text-primary mb-1">{formatTime(booking.start_at)}</div>
                        <div className="text-xs text-gray-700 truncate">
                          {booking.services[0]?.service?.name_en || ""}
                        </div>
                      </div>
                    ))}
                    {dayBookings.length > 2 && (
                      <div className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-6 px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDayClick(day);
                          }}
                        >
                          <Eye className="w-3 h-3 mr-1" />+{dayBookings.length - 2} more
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-center text-sm text-gray-500 mt-4">
        Click on any day to view detailed schedule and manage bookings
      </div>

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

export default WeeklyCalendar;
