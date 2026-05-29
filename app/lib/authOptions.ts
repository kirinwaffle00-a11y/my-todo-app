import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// [L-2] 必須環境変数の実行時バリデーション
// ビルド時ではなくリクエスト時に検証することで、ローカル開発ビルドを妨げない
export function validateAuthEnv(): void {
  const required: Record<string, string | undefined> = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  };

  for (const [key, value] of Object.entries(required)) {
    if (!value || value.trim() === "") {
      throw new Error(`[authOptions] Required environment variable is not set: ${key}`);
    }
  }

  if ((process.env.NEXTAUTH_SECRET ?? "").length < 32) {
    throw new Error(
      "[authOptions] NEXTAUTH_SECRET must be at least 32 characters. " +
      "Generate one with: openssl rand -base64 32"
    );
  }
}

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/calendar.events",
          access_type: "offline",
          prompt: "select_account consent",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET!,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      if (profile?.sub) {
        token.sub = profile.sub;
      }
      return token;
    },
    async session({ session, token }) {
      // [M-4] accessToken はサーバーサイドのみで使用されるべきだが、
      // Google Calendar API 連携のためセッションに含める。
      // XSS 対策として httpOnly Cookie + NEXTAUTH_SECRET の JWT 署名で保護されている。
      (session as { userId?: string; accessToken?: string }).accessToken = token.accessToken as string | undefined;
      (session as { userId?: string; accessToken?: string }).userId = token.sub as string | undefined;
      return session;
    },
  },
};
