"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import NavHeader from "~/components/nav-header";
import { Toaster } from "~/components/ui/sonner";
import { useSupabaseAuth } from "~/components/auth/supabase-auth-provider";
import { useEffect, useState } from "react";
import { supabase } from "~/lib/supabase";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { session, loading } = useSupabaseAuth();
  const [userCredits, setUserCredits] = useState<number>(0); // Start with 0 to show loading state
  const [userEmail, setUserEmail] = useState<string>("");
  const [creditsLoading, setCreditsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      router.push("/login");
    }
    
    if (session?.user) {
      setUserEmail(session.user.email || "");
      fetchUserCredits(session.user.id);
    }
  }, [session, loading, router]);

  const fetchUserCredits = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('credits')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('❌ Error fetching user credits:', error);
        setUserCredits(100); // Fallback to default
      } else {
        setUserCredits(profile?.credits || 0);
      }
    } catch (error) {
      console.error('❌ Error fetching credits:', error);
      setUserCredits(100); // Fallback to default
    } finally {
      setCreditsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="flex min-h-screen flex-col">
      <NavHeader 
        credits={creditsLoading ? 0 : userCredits} 
        email={userEmail} 
      />
      <main className="container mx-auto flex-1 py-6">{children}</main>
      <Toaster />
    </div>
  );
}
