import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar as CalendarIcon } from "lucide-react";
import { Booking, BookingStatus, BookingService } from "@/types";
import BookingDrawer from "./BookingDrawer";
import WalkinModal from "./WalkinModal";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface BookingTableProps {
  selectedDate: string;
}

// --- Add this normalization function at the top! ---
const normalizeBooking = (raw: Record<string, unknown>): Booking => {
  return {
    // Safely handle services array and normalize each service object
    services: Array.isArray(raw.services)
      ? (raw.services as Record<string, unknown>[]).map((serviceRaw) => ({
          service_id:
            typeof serviceRaw.service_id === "string"
              ? serviceRaw.service_id
              : "",
          name_en:
            typeof serviceRaw.name_en === "string" ? serviceRaw.name_en : "",
          name_ar:
            typeof serviceRaw.name_ar === "string" ? serviceRaw.name_ar : "",
          category:
            typeof serviceRaw.category === "string" ? serviceRaw.category : "",
          duration_min:
            typeof serviceRaw.duration_min === "number"
              ? serviceRaw.duration_min
              : 0,
          price_jd:
            typeof serviceRaw.price_jd === "number" ? serviceRaw.price_jd : 0,
          staff_level:
            typeof serviceRaw.staff_level === "string"
              ? serviceRaw.staff_level
              : "",
        }))
      : [],

    // Handle numeric fields with proper defaults
    total_price: typeof raw.total_price === "number" ? raw.total_price : 0,

    total_duration:
      typeof raw.total_duration === "number" ? raw.total_duration : 0,

    // Fix: Use customer_phone instead of phone to match Booking type
    customer_phone:
      typeof raw.customer_phone === "string"
        ? raw.customer_phone
        : typeof raw.phone === "string"
        ? raw.phone
        : "",

    // Fix: Add missing customer_name property
    customer_name:
      typeof raw.customer_name === "string"
        ? raw.customer_name
        : typeof raw.name === "string"
        ? raw.name
        : "",

    // Handle optional string fields
    notes: typeof raw.notes === "string" ? raw.notes : "",

    // Handle date/time fields
    end_at: typeof raw.end_at === "string" ? raw.end_at : "",

    start_at: typeof raw.start_at === "string" ? raw.start_at : "",

    // Add the missing required properties
    id:
      typeof raw.id === "string"
        ? raw.id
        : typeof raw.id === "number"
        ? raw.id.toString()
        : "",

    status:
      typeof raw.status === "string" &&
      ["confirmed", "arrived", "done", "cancelled"].includes(raw.status)
        ? (raw.status as "confirmed" | "arrived" | "done" | "cancelled")
        : "confirmed", // Use a valid default status from the union

    created_at:
      typeof raw.created_at === "string"
        ? raw.created_at
        : new Date().toISOString(),

    modified_at:
      typeof raw.modified_at === "string"
        ? raw.modified_at
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

  // Fetch bookings from your backend
  useEffect(() => {
    setLoading(true);
    setError(null);
    api(`/bookings/today`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load bookings");
        return await res.json();
      })
      .then((data) => {
        // Supports both array and {bookings: array}
        const bookingsArr = Array.isArray(data) ? data : data.bookings ?? [];
        setBookings(bookingsArr.map(normalizeBooking));
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
      <Badge
        variant="outline"
        className={`${statusClasses[status]} lovable-transition`}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatTime = (dateTime: string) => {
    return new Date(dateTime).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const handleBookingClick = (booking: Booking) => {
    setSelectedBooking(booking);
    setIsDrawerOpen(true);
  };

  const handleStatusUpdate = async (
    bookingId: string,
    status: BookingStatus
  ) => {
    if (status === "cancelled") {
      try {
        // Call backend to cancel booking
        console.log("Cancel clicked:", bookingId, status);
        const res = await api(`/bookings/${bookingId}/cancel`, {
          method: "POST",
        });
        if (!res.ok) throw new Error("Failed to cancel booking");

        // Now update local state/UI only if backend succeeded:
        setBookings((prevBookings) =>
          prevBookings.map((booking) =>
            booking.id === bookingId
              ? {
                  ...booking,
                  status,
                  modified_at: new Date().toISOString(),
                }
              : booking
          )
        );
        if (selectedBooking?.id === bookingId) {
          setSelectedBooking((prev) =>
            prev
              ? { ...prev, status, modified_at: new Date().toISOString() }
              : null
          );
        }
        toast({
          title: "Booking Cancelled",
          description: "Booking was cancelled successfully.",
          duration: 3000,
        });

        setRefreshKey((prev) => prev + 1); // Refetch from backend if you want
        setIsDrawerOpen(false); // Optionally close the drawer
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

    // --- existing logic for other statuses if needed ---
    setBookings((prevBookings) =>
      prevBookings.map((booking) =>
        booking.id === bookingId
          ? {
              ...booking,
              status,
              modified_at: new Date().toISOString(),
            }
          : booking
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
    toast({
      title: "Status Updated",
      description: statusMessages[status],
      duration: 3000,
    });

    setRefreshKey((prev) => prev + 1);
  };

  const handleBookingUpdate = (updatedBooking: Booking) => {
    setBookings((prevBookings) =>
      prevBookings.map((booking) =>
        booking.id === updatedBooking.id
          ? {
              ...updatedBooking,
              modified_at: new Date().toISOString(),
            }
          : booking
      )
    );
    setSelectedBooking({
      ...updatedBooking,
      modified_at: new Date().toISOString(),
    });

    // === ADDED: force refetch from backend ===
    setRefreshKey((prev) => prev + 1);

    toast({
      title: "Booking Updated",
      description: "Booking details have been successfully updated",
      duration: 3000,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h2 className="text-3xl font-bold text-gray-900">Today's Bookings</h2>
          <div className="flex items-center text-sm text-gray-600">
            <CalendarIcon className="w-4 h-4 mr-1" />
            {new Date(selectedDate).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>

        <Button
          onClick={() => setIsWalkinModalOpen(true)}
          className="lovable-shadow lovable-transition hover:scale-105"
        >
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
              <h3 className="text-lg font-semibold text-gray-600 mb-2">
                No bookings today
              </h3>
              <p className="text-gray-500 mb-4">
                Start by adding a walk-in booking
              </p>
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
                      <div className="text-lg font-semibold text-primary">
                        {formatTime(booking.start_at)}
                      </div>
                      {getStatusBadge(booking.status)}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">Services:</span>
                        <span className="text-gray-600">
                          {(booking.services ?? [])
                            .map((bs) => bs.name_en || "")
                            .join(", ")}
                        </span>
                      </div>

                      {booking.customer_phone && (
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">Phone:</span>
                          <span className="text-gray-600">
                            {booking.customer_phone}
                          </span>
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
                    <div className="text-lg font-bold text-primary">
                      {booking.total_price} JD
                    </div>
                    <div className="text-sm text-gray-500">
                      {booking.total_duration} min
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Booking Drawer */}
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

      {/* Walk-in Modal */}
      <WalkinModal
        isOpen={isWalkinModalOpen}
        onClose={() => setIsWalkinModalOpen(false)}
        onSubmit={(walkinData) => {
          setIsWalkinModalOpen(false);
          setRefreshKey((prev) => prev + 1); // <-- Add this line!
        }}
      />
    </div>
  );
};

export default BookingTable;
