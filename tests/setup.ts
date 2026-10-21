import { vi } from "vitest";

// `server-only` throws when imported outside a React Server environment.
// Tests run in plain Node, so replace it with an empty module.
vi.mock("server-only", () => ({}));
