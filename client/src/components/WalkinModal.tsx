import { useEffect, useState } from "react";
import { http } from "@/lib/http"; // ⬅️ use our authenticated client
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Service {
  service_id: string;
  name_en: string;
  name_ar: string;
  price_jd: number;
  duration_min: number;
  category?: string;
  staff_level?: string;
}

interface WalkinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (data: WalkinData) => void;
}

interface WalkinData {
  services: string[];
  startTime: string;
  phone?: string;
}

const WalkinModal = ({ isOpen, onClose, onSubmit }: WalkinModalProps) => {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  // Fetch all services when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    http
      .get("/services") // ⬅️ was "api/services"
      .then((res) => {
        setServices(res.data.services || []);
        setSelectedServices([]);
        setStartTime("");
        setPhone("");
      })
      .catch((err) => {
        console.error("Failed to load services", err);
        setServices([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Toggle selection
  const handleServiceToggle = (serviceId: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  // Total calculation
  const calculateTotal = () => {
    const selectedList = services.filter((s) =>
      selectedServices.includes(s.service_id)
    );
    const totalPrice = selectedList.reduce(
      (sum, s) => sum + (s.price_jd ?? 0),
      0
    );
    const totalDuration = selectedList.reduce(
      (sum, s) => sum + (s.duration_min ?? 0),
      0
    );
    return { totalPrice, totalDuration };
  };
  const { totalPrice, totalDuration } = calculateTotal();

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startTime || selectedServices.length === 0) return;

    try {
      await http.post("/bookings", {
        start_at: new Date(startTime).toISOString(),
        service_ids: selectedServices,
        customer_phone: phone || null,
        customer_name: "",
      });
      onSubmit?.({
        services: selectedServices,
        startTime,
        phone: phone || undefined,
      });
      handleClose();
    } catch (err) {
      console.error("Failed to create booking", err);
      // TODO: show toast
    }
  };

  // Reset all fields & close
  const handleClose = () => {
    setSelectedServices([]);
    setStartTime("");
    setPhone("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-primary">
            Walk-in Booking
          </DialogTitle>
          <DialogDescription>
            Create a new booking for a walk-in customer
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-6 text-center">Loading services…</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Service Selection */}
            <div>
              <Label className="text-base font-medium mb-3 block">
                Select Services *
              </Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {services.map((service) => {
                  const isChecked = selectedServices.includes(service.service_id);
                  return (
                    <label
                      key={service.service_id}
                      className={`border rounded-lg p-4 flex items-start justify-between cursor-pointer transition ${
                        isChecked
                          ? "border-primary bg-primary/5"
                          : "border-gray-200 hover:border-primary/50"
                      }`}
                      htmlFor={`walkin-service-${service.service_id}`}
                      tabIndex={0}
                      onKeyPress={(e) => {
                        if (e.key === " " || e.key === "Enter")
                          handleServiceToggle(service.service_id);
                      }}
                      style={{ userSelect: "none" }}
                    >
                      <div className="flex items-start space-x-3">
                        <input
                          id={`walkin-service-${service.service_id}`}
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleServiceToggle(service.service_id)}
                          className="mt-1 accent-primary"
                          tabIndex={-1}
                        />
                        <div>
                          <div className="font-medium">{service.name_en}</div>
                          {service.name_ar && (
                            <div className="text-sm text-gray-600">
                              {service.name_ar}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right min-w-[60px]">
                        <div className="font-medium text-primary">
                          {service.price_jd} JD
                        </div>
                        <div className="text-sm text-gray-600">
                          {service.duration_min} min
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Date & Time Picker */}
            <div>
              <Label htmlFor="startTime" className="text-base font-medium">
                Start Time *
              </Label>
              <Input
                id="startTime"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full mt-2 p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                required
              />
            </div>

            {/* Phone */}
            <div>
              <Label htmlFor="phone" className="text-base font-medium">
                Phone Number
              </Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+962-79-xxx-xxxx"
                className="mt-2"
              />
            </div>

            {/* Total Summary */}
            {selectedServices.length > 0 && (
              <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Total:</span>
                  <div className="text-right">
                    <div className="text-lg font-bold text-primary">
                      {totalPrice} JD
                    </div>
                    <div className="text-sm text-gray-600">
                      {totalDuration} minutes
                    </div>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="space-x-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={selectedServices.length === 0 || !startTime || loading}
                className="lovable-shadow"
              >
                Create Booking
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default WalkinModal;
