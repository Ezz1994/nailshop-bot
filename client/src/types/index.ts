/* ------------------------------------------------------------------
   Shared type definitions
   -----------------------------------------------------------------*/

/** The lifecycle states a booking can have */
export type BookingStatus = 'confirmed' | 'arrived' | 'done' | 'cancelled';

/* ------------------------------------------------------------------
   Core domain models
   -----------------------------------------------------------------*/

export interface Booking {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  created_at: string;
  modified_at: string;
  notes: string;

  /** Services attached to this booking (normalised) */
  services: BookingService[];

  /** Convenience totals (may come from backend or be recomputed) */
  total_price: number;
  total_duration: number;
}

/**
 * A single service line _after_ normalisation.
 * The new `service` field is **optional** so existing
 * WhatsApp/manual flows are untouched.
 */
export interface BookingService {
  service_id: string;
  name_en: string;
  name_ar: string;
  category: string;
  duration_min: number;
  price_jd: number;
  staff_level: string;

  /** <-‑‑ NEW (optional) --------------------------------------------------
   *  Extra detail object used by the Weekly Calendar UI.
   *  Leave it undefined everywhere else and nothing breaks.
   */
  service?: {
    id: string;
    name_en: string;
    name_ar: string;
    price: number;
    duration_min: number;
    staff_level?: string;
  };
}

/** Static service catalogue entry */
export interface Service {
  service_id: string;
  name_en: string;
  name_ar: string;
  category?: string | null;
  duration_min: number;
  price_jd: number;
  staff_level?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;           // ISO string, or Date if you parse
}

/** Simple auth/user model */
export interface User {
  id: string;
  email: string;
  role: 'owner' | 'staff';
}

/* ------------------------------------------------------------------
   “Raw” shapes (direct DB/API payloads before normalisation)
   -----------------------------------------------------------------*/

/** A service record as it comes from the DB / Supabase RPC */
export interface RawService {
  id?: string;
  booking_id?: string;
  service_id?: string;
  name_en?: string;
  name_ar?: string;
  category?: string;
  price_jd?: number;
  price?: number;
  duration_min?: number;
  staff_level?: string;
  service?: {
    id?: string;
    service_id?: string; // <-- add this line!
    name_en?: string;
    name_ar?: string;
    price?: number;
    price_jd?: number;
    duration_min?: number;
    staff_level?: string;
  };
  [key: string]: unknown;
}


/** A booking row straight from the DB before we massage it */
export interface RawBooking {
  id: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  customer_phone?: string;
  phone?: string;
  customer_name?: string;
  notes?: string;
  created_at: string;
  modified_at: string;
  services?: RawService[]; // For /range or old API
  booking_services?: RawService[]; // For /day API!
  total_price?: number;
  total_duration?: number;
}