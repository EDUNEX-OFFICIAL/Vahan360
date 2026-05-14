import { NextResponse } from 'next/server';

/** Liveness for Docker/K8s only. Public nginx still maps `/health` → api-express. */
export function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'vahan360-web' },
    { status: 200 },
  );
}
