import { SupabaseAuth } from "~/components/auth/supabase-auth";

export default function LoginPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold">Sign in to Auclip</h1>
          <p className="text-sm text-gray-600 mt-2">
            Use your Google or GitHub account to sign in
          </p>
        </div>
        <SupabaseAuth />
      </div>
    </div>
  );
}
