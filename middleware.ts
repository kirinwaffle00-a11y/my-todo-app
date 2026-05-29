import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

// [H-2] API ルートも含めてすべてのルートを認証必須にする。
// 除外するのは:
//   - NextAuth ハンドラ本体 (api/auth/...)
//   - ログインページ
//   - 静的アセット
//   - Cron は CRON_SECRET で独自認証するため除外
export const config = {
  matcher: [
    "/((?!api/auth|api/cron|api/ai|login|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
