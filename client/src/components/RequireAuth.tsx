// src/components/RequireAuth.tsx
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

export default function RequireAuth({ children }: { children: JSX.Element }) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

 if (loading) return <div>Loading...</div>;
  return authed ? children : <Navigate to="/login" replace />;
}
