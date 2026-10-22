export declare const MOCK_AUTH_PORT: number;
export declare const E2E_ANON_KEY: string;
export declare const E2E_SERVICE_KEY: string;
export declare const E2E_DATABASE_URL: string;

export type E2EUser = {
  authUserId: string;
  email: string;
  password: string;
  fullName: string;
  role: "OWNER" | "SALES" | "STOREKEEPER" | null;
};

export declare const E2E_USERS: {
  owner: E2EUser;
  sales: E2EUser;
  storekeeper: E2EUser;
  stranger: E2EUser;
};
export declare const E2E_OWNER_WHATSAPP: string;
export declare const E2E_META_APP_SECRET: string;
export declare const E2E_VERIFY_TOKEN: string;
