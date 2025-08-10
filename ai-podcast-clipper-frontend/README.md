# AI Podcast Clipper Frontend

This is the frontend for the AI Podcast Clipper application, built with Next.js and modern web technologies.

## Technology Stack

This project uses the following technologies:

- [Next.js](https://nextjs.org) - React framework for production
- [Supabase](https://supabase.com) - Backend-as-a-Service with authentication and database
- [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Stripe](https://stripe.com) - Payment processing
- [Inngest](https://inngest.com) - Background job processing
- [AWS S3](https://aws.amazon.com/s3/) / [Cloudflare R2](https://cloudflare.com/products/r2/) - File storage
- [Remotion](https://remotion.dev) - Video rendering

## Features

- **Supabase Authentication** - Google and GitHub OAuth login
- **Video Processing** - YouTube URL processing and file uploads
- **AI-Powered Clipping** - Automatic viral moment detection
- **TikTok-Style Captions** - Professional video captions with custom fonts
- **Payment Integration** - Stripe-powered credit system
- **Real-time Updates** - Live processing status updates
- **Responsive Design** - Mobile-first responsive interface

## Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables (see `SUPABASE_SETUP.md`)
4. Run the development server: `npm run dev`

## Environment Setup

See `SUPABASE_SETUP.md` for detailed setup instructions including:
- Supabase project configuration
- Google/GitHub OAuth setup
- Database schema deployment
- Environment variables

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run typecheck` - Type checking
