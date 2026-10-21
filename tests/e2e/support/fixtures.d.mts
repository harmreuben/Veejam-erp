export declare const MOCK_AUTH_PORT: number;
export declare const E2E_ANON_KEY: string;
export declare const E2E_SERVICE_KEY: string;
export declare const E2E_DATABASE_URL: string;

export type E2EUser = {
  authUserId: string;
  email: string;
  password: string;
  fullName: string;
  role: "OWNER" | "SALES" | null;
};

export declare const E2E_USERS: {
  owner: E2EUser;
  sales: E2EUser;
  stranger: E2EUser;
};
