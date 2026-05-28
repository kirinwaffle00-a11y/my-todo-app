import type { NextConfig } from "next";

// [H-4] 開発用トンネルサービスのワイルドカードドメインを本番 config から除去。
// ローカル開発でトンネルが必要な場合は .env.local の NEXTAUTH_URL を変更してください。
const nextConfig: NextConfig = {};

export default nextConfig;
