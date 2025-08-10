import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
        <h1 className="text-5xl font-extrabold tracking-tight text-white sm:text-[5rem]">
          <span className="text-[hsl(280,100%,70%)]">Auclip</span>
        </h1>
        <p className="text-xl text-center max-w-2xl">
          Transform your YouTube videos and podcasts into viral TikTok-style clips with AI-powered moment detection and professional captions.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-8">
          <Link
            className="flex max-w-xs flex-col gap-4 rounded-xl bg-white/10 p-4 text-white hover:bg-white/20"
            href="/login"
          >
            <h3 className="text-2xl font-bold">Login →</h3>
            <div className="text-lg">
              Sign in to your account to start creating viral clips from your content.
            </div>
          </Link>
          <Link
            className="flex max-w-xs flex-col gap-4 rounded-xl bg-white/10 p-4 text-white hover:bg-white/20"
            href="/signup"
          >
            <h3 className="text-2xl font-bold">Sign Up →</h3>
            <div className="text-lg">
              Create a new account and get started with AI-powered podcast clipping.
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
