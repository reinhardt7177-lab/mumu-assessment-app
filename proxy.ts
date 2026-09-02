import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Missing credentials never enable a fake identity. Protected APIs fail closed.
export default process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware()
  : () => NextResponse.next();

// Run on every request. Route handlers still perform their own teacher checks,
// and avoiding a complex negative-lookahead keeps both Next.js and vinext aligned.
