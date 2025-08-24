// BookingDrawer.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Booking, BookingStatus, BookingService, Service } from "@/types";
import { Edit, Save } from "lucide-react";
import { DateTime } from "luxon";
import { http } from "@/lib/http";     // ✅ authenticated axios client
import axios from "axios";             // for axios.isCancel

interface BookingDrawerProps {
  booking: Booking | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusUpdate: (bookingId: string, status: BookingStatus) => void;
  onBookingUpdate: (booking: Booking) => void;
}

const formatDateTimeForInput = (dateTime?: string | null) => {
  if (!dateTime) return "";
  const d = new Date(dateTime);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const BookingDrawer = ({
  booking,
  isOpen,
  onClose,
  onStatusUpdate,
  onBookingUpdate,
}: BookingDrawerProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedBooking, setEditedBooking] = useState<Booking | null>(null);
  const [availableServices, setAvailableServices] = useState<Service[]>([]);

  // ✅ Authenticated load of services
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      try {
        const { data } = await http.get<{ services: Service[] }>("/services", {
          signal: controller.signal,
        });
        const list = data?.services ?? [];
        setAvailableServices(list.map((s) => ({ ...s, id: s.service_id })));
      } catch (err) {
        if (axios.isCancel(err)) return;
        console.error("Failed to load services", err);
        setAvailableServices([]);
      }
    };
    run();
    return () => controller.abort();
  }, []);

  if (!booking) return null;

  const handleEditClick = () => {
    setIsEditing(true);
    setEditedBooking({ ...booking });
  };

  const handleSaveClick = async () => {
    if (!editedBooking) return;

    try {
      const formatAsAmmanISO = (localDateTimeString: string) => {
        if (!localDateTimeString) return null;
        const d = new Date(localDateTimeString);
        const dt = DateTime.fromJSDate(d, { zone: "local" });
        const amman = DateTime.fromObject(
          {
            year: dt.year, month: dt.month, day: dt.day,
            hour: dt.hour, minute: dt.minute, second: dt.second, millisecond: dt.millisecond,
          },
          { zone: "Asia/Amman" }
        );
        return amman.toISO();
      };

      const servicesChanged =
        JSON.stringify(booking.services) !== JSON.stringify(editedBooking.services);

      const payload: Record<string, unknown> = {
        start_at: formatAsAmmanISO(editedBooking.start_at),
        end_at: formatAsAmmanISO(editedBooking.end_at),
        phone: editedBooking.customer_phone,
        notes: editedBooking.notes,
        total_price: editedBooking.total_price,
        total_duration: editedBooking.total_duration,
      };
      if (servicesChanged) payload.services = editedBooking.services;

      // ✅ Authenticated update
      const { data } = await http.put<{ booking?: Booking }>(
        `/bookings/${editedBooking.id}`,
        payload
      );

      onBookingUpdate(data.booking ?? editedBooking);
      setIsEditing(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert("Failed to update booking: " + message);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedBooking(null);
  };

  const handleInputChange = (field: keyof Booking, value: string) => {
    if (editedBooking) setEditedBooking({ ...editedBooking, [field]: value });
  };

  // Update the whole BookingService entry, not just the id!
  const handleServiceChange = (serviceIndex: number, newServiceId: string) => {
    if (!editedBooking) return;
    const selectedService = availableServices.find((s) => s.service_id === newServiceId);
    if (!selectedService) return;

    const newBookingService: BookingService = {
      service_id: selectedService.service_id,
      name_en: selectedService.name_en,
      name_ar: selectedService.name_ar,
      category: selectedService.category || "",
      duration_min: selectedService.duration_min,
      price_jd: selectedService.price_jd,
      staff_level: selectedService.staff_level || "",
    };

    const updatedServices = [...editedBooking.services];
    updatedServices[serviceIndex] = newBookingService;

    const totalPrice = updatedServices.reduce((sum, s) => sum + (s.price_jd ?? 0), 0);
    const totalDuration = updatedServices.reduce((sum, s) => sum + (s.duration_min ?? 0), 0);

    setEditedBooking({
      ...editedBooking,
      services: updatedServices,
      total_price: totalPrice,
      total_duration: totalDuration,
    });
  };

  const getStatusBadge = (status: BookingStatus) => {
    const statusClasses = {
      confirmed: "status-confirmed",
      arrived: "status-arrived",
      done: "status-done",
      cancelled: "status-cancelled",
    } as const;
    return (
      <Badge variant="outline" className={statusClasses[status]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatDateTime = (dateTime: string) =>
    new Date(dateTime).toLocaleString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });

  const canMarkArrived = booking.status === "confirmed";
  const canMarkDone = booking.status === "arrived";
  const canCancel = booking.status !== "cancelled" && booking.status !== "done";
  const canEdit = booking.status === "confirmed";

  const currentBooking = editedBooking || booking;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md flex flex-col h-full">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl font-bold text-primary">Booking Details</SheetTitle>
            {!isEditing && canEdit && (
              <Button onClick={handleEditClick} variant="outline" size="sm" className="ml-2">
                <Edit className="w-4 h-4" />
              </Button>
            )}
          </div>
          <SheetDescription>
            {isEditing ? "Edit booking information" : "Manage this booking's status and information"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-grow overflow-y-auto space-y-6 py-6">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="font-medium">Status:</span>
            {getStatusBadge(booking.status)}
          </div>

          {/* Time */}
          <div>
            <span className="font-medium block mb-2">Schedule:</span>
            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="start_at">Start Time</Label>
                  <Input
                    id="start_at"
                    type="datetime-local"
                    value={formatDateTimeForInput(editedBooking?.start_at ?? booking.start_at)}
                    onChange={(e) => handleInputChange("start_at", e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-sm text-gray-600">Start</div>
                <div className="font-medium">{formatDateTime(booking.start_at)}</div>
                <div className="text-sm text-gray-600 mt-2">End</div>
                <div className="font-medium">{formatDateTime(booking.end_at)}</div>
              </div>
            )}
          </div>

          {/* Services */}
          <div>
            <span className="font-medium block mb-2">Services:</span>
            <div className="space-y-2">
              {currentBooking.services.map((bookingService, index) => (
                <div
                  key={`${bookingService.service_id}-${index}`}
                  className="bg-primary/5 rounded-lg p-3 border border-primary/20"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      {isEditing ? (
                        <div className="space-y-2">
                          <Select
                            value={bookingService.service_id}
                            onValueChange={(newServiceId) => handleServiceChange(index, newServiceId)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select a service..." />
                            </SelectTrigger>
                            <SelectContent className="bg-white border shadow-lg z-50">
                              {availableServices.map((service) => (
                                <SelectItem key={service.service_id} value={service.service_id}>
                                  <div className="flex justify-between items-center w-full">
                                    <span>{service.name_en}</span>
                                    <span className="text-sm text-gray-500 ml-2">
                                      {service.price_jd} JD
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div>
                          <div className="font-medium">{bookingService.name_en}</div>
                        </div>
                      )}
                    </div>
                    <div className="text-right ml-4">
                      <div className="font-medium text-primary">{bookingService.price_jd} JD</div>
                      <div className="text-sm text-gray-600">{bookingService.duration_min} min</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

            {/* Contact Info */}
          <div>
            <span className="font-medium block mb-2">Phone:</span>
            {isEditing ? (
              <Input
                value={editedBooking?.customer_phone || ""}
                onChange={(e) => handleInputChange("customer_phone", e.target.value)}
                placeholder="Phone number"
              />
            ) : booking.customer_phone ? (
              <div className="bg-gray-50 rounded-lg p-3">
                <a href={`tel:${booking.customer_phone}`} className="text-primary hover:underline">
                  {booking.customer_phone}
                </a>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-3 text-gray-500">No phone number</div>
            )}
          </div>

          {/* Notes */}
          <div>
            <span className="font-medium block mb-2">Notes:</span>
            {isEditing ? (
              <Textarea
                value={editedBooking?.notes || ""}
                onChange={(e) => handleInputChange("notes", e.target.value)}
                placeholder="Add notes..."
                rows={3}
              />
            ) : booking.notes ? (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-700">{booking.notes}</p>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-3 text-gray-500">No notes</div>
            )}
          </div>

          {/* Total */}
          <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
            <div className="flex justify-between items-center">
              <span className="font-medium">Total:</span>
              <div className="text-right">
                <div className="text-lg font-bold text-primary">{currentBooking.total_price} JD</div>
                <div className="text-sm text-gray-600">{currentBooking.total_duration} minutes</div>
              </div>
            </div>
          </div>
        </div>

        <SheetFooter className="space-y-2">
          {isEditing ? (
            <div className="flex space-x-2 w-full">
              <Button onClick={handleSaveClick} className="flex-1 bg-green-600 hover:bg-green-700">
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
              <Button onClick={handleCancelEdit} variant="outline" className="flex-1">
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-col space-y-2 w-full">
              {canMarkArrived && (
                <Button onClick={() => onStatusUpdate(booking.id, "arrived")} className="w-full bg-green-600 hover:bg-green-700">
                  Mark as Arrived
                </Button>
              )}
              {canMarkDone && (
                <Button onClick={() => onStatusUpdate(booking.id, "done")} className="w-full bg-gray-600 hover:bg-gray-700">
                  Mark as Done
                </Button>
              )}
              {canCancel && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full">Cancel Booking</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel Booking</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to cancel this booking? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep Booking</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onStatusUpdate(booking.id, "cancelled")}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        Cancel Booking
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default BookingDrawer;
