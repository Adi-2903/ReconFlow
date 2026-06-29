import NextAuth, { type DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      onboarded: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    onboarded?: boolean;
  }
}

declare module "@auth/core/types" {
  interface User {
    id?: string;
    onboarded?: boolean;
  }
  interface Session {
    user: {
      id: string;
      onboarded: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    onboarded?: boolean;
  }
}
