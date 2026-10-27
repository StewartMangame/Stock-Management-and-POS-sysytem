/**
 * Augment Auth.js / next-auth types to include custom fields
 * added to the JWT and Session in auth.ts.
 */
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string | null;
      /** UUID of the user's assigned role */
      roleId: string;
      /** If true, the user must change their password before doing anything else */
      forcePasswordChange: boolean;
    };
  }

  interface User {
    roleId: string;
    forcePasswordChange: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    roleId: string;
    forcePasswordChange: boolean;
    isActive?: boolean;
  }
}
